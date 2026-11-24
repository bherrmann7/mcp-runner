import {WorkflowRunner} from '../index.js';
import {execFileSync} from 'child_process';
import {fileURLToPath} from 'url';
import CONFIG from '../config.js';

const ADB_PATH = `${process.env.HOME}/Library/Android/sdk/platform-tools/adb`;

// Parse command line arguments
const args = process.argv.slice(2);
const NO_ALARM = args.includes('-na') || args.includes('--no-alarm');
const NO_EMAIL = args.includes('-ne') || args.includes('--no-email');
// Which google-calendar-mcp account to read mail from, and how many subjects to show.
const EMAIL_ACCOUNT = 'work';
const EMAIL_COUNT = 20;
// Optional day offset from today (e.g. `1` = tomorrow, `2` = day after).
// When provided, it overrides the default today/after-5pm behavior.
const dayOffsetArg = args.find(a => /^-?\d+$/.test(a));
const DAY_OFFSET = dayOffsetArg !== undefined ? parseInt(dayOffsetArg, 10) : null;

function isAllDay(event) {
    const start = new Date(event.Start);
    const end = new Date(event.End);
    const diffHours = (end - start) / (1000 * 60 * 60);
    return diffHours > 0 && diffHours % 24 === 0;
}

function formatEventsTable(events) {
    const fmtTime = (e) => {
        if (isAllDay(e)) return 'All Day';
        const opts = { hour: '2-digit', minute: '2-digit', hour12: true };
        const start = new Date(e.Start).toLocaleTimeString('en-US', opts);
        const end = e.End ? new Date(e.End).toLocaleTimeString('en-US', opts) : '';
        return end ? `${start} - ${end}` : start;
    };

    const shortCal = (e) => {
        if (e.IsPrimary) return e.Account;
        return e.CalendarName.split('@')[0];
    };

    // Timed events first, then all-day
    const timed = events.filter(e => !isAllDay(e));
    const allDay = events.filter(e => isAllDay(e));
    const ordered = [...timed, ...allDay];

    // Build rows: each event produces 1+ rows (extra for location)
    // Blank rows between events for readability
    const rows = [];
    for (let i = 0; i < ordered.length; i++) {
        const e = ordered[i];
        const isSeparator = i === timed.length && timed.length > 0;
        if (i > 0 && !isSeparator) {
            rows.push({ time: '', cal: '', desc: '', sep: false });
        }
        rows.push({ time: fmtTime(e), cal: shortCal(e), desc: e.Summary || 'No title', sep: isSeparator });
        if (e.Location) {
            rows.push({ time: '', cal: '', desc: `@ ${e.Location}`, sep: false });
        }
    }

    // Column widths
    const timeW = Math.max(4, ...rows.map(r => r.time.length));
    const calW = Math.max(8, ...rows.map(r => r.cal.length));
    const descW = Math.max(11, ...rows.map(r => r.desc.length));

    const pad = (s, w) => s + ' '.repeat(Math.max(0, w - s.length));
    const hr = (l, m, r) => l + '─'.repeat(timeW + 2) + m + '─'.repeat(calW + 2) + m + '─'.repeat(descW + 2) + r;
    const row = (t, c, d) => `│ ${pad(t, timeW)} │ ${pad(c, calW)} │ ${pad(d, descW)} │`;

    const lines = [];
    lines.push(hr('┌', '┬', '┐'));
    lines.push(row('Time', 'Calendar', 'Description'));
    lines.push(hr('├', '┼', '┤'));
    for (const r of rows) {
        if (r.sep) lines.push(hr('├', '┼', '┤'));
        lines.push(row(r.time, r.cal, r.desc));
    }
    lines.push(hr('└', '┴', '┘'));

    return lines.join('\n');
}

/**
 * When events share the same start and end time across calendars,
 * keep the one with more information (i.e. has a title).
 */
function deduplicateEvents(events) {
    const groups = new Map();
    for (const event of events) {
        const key = `${event.Start}|${event.End}`;
        if (!groups.has(key)) {
            groups.set(key, []);
        }
        groups.get(key).push(event);
    }

    const result = [];
    for (const group of groups.values()) {
        if (group.length === 1) {
            result.push(group[0]);
        } else {
            // Prefer events that have a title (Summary)
            const withTitle = group.filter(e => e.Summary && e.Summary.trim());
            if (withTitle.length > 0) {
                result.push(...withTitle);
            } else {
                result.push(group[0]);
            }
        }
    }
    return result;
}

/**
 * Show tomorrow's calendar events from all calendars for work account
 */
async function showTomorrowEvents(mcpManager) {
    try {
        // Calculate target date based on current time
        const now = new Date();
        const targetDate = new Date();

        // An explicit day offset wins; otherwise after 5pm use tomorrow, else today.
        if (DAY_OFFSET !== null) {
            targetDate.setDate(targetDate.getDate() + DAY_OFFSET);
        } else if (now.getHours() >= 17) {
            targetDate.setDate(targetDate.getDate() + 1);
        }

        const dayAfter = new Date(targetDate);
        dayAfter.setDate(dayAfter.getDate() + 1);

        // Format dates in local timezone to avoid UTC conversion issues
        const formatLocalDate = (date) => {
            const year = date.getFullYear();
            const month = String(date.getMonth() + 1).padStart(2, '0');
            const day = String(date.getDate()).padStart(2, '0');
            return `${year}-${month}-${day}`;
        };

        const timeMin = formatLocalDate(targetDate) + 'T00:00:00';
        const timeMax = formatLocalDate(dayAfter) + 'T00:00:00';

        const accounts = ['work', 'home'];
        let allEvents = [];

        for (const account of accounts) {
            const calendarsResult = await mcpManager.callTool(
                'google-calendar',
                'list_calendars',
                {account}
            );

            if (!calendarsResult.content || !calendarsResult.content[0]) {
                console.log(`⚠️  Failed to get calendars for ${account} account`);
                continue;
            }

            const calendarsData = JSON.parse(calendarsResult.content[0].text);

            if (calendarsData.error || !calendarsData.Calendars || calendarsData.Calendars.length === 0) {
                console.log(`⚠️  Error accessing ${account} calendars:`, calendarsData.error);
                continue;
            }

            for (const calendar of calendarsData.Calendars) {
                try {
                    const eventsResult = await mcpManager.callTool(
                        'google-calendar',
                        'list_events',
                        {
                            account,
                            calendarId: calendar.Id,
                            timeMin: timeMin,
                            timeMax: timeMax,
                            maxResults: 50
                        }
                    );

                    if (eventsResult.content && eventsResult.content[0] && eventsResult.content[0].text) {
                        const eventsData = JSON.parse(eventsResult.content[0].text);

                        if (eventsData.error) {
                            console.log(`      ⚠️  Error accessing "${calendar.Summary}": ${eventsData.error}`);
                            continue;
                        }

                        if (eventsData.Events && eventsData.Events.length > 0) {
                            eventsData.Events.forEach(event => {
                                event.CalendarName = calendar.Summary;
                                event.CalendarId = calendar.Id;
                                event.IsPrimary = calendar.Primary || false;
                                event.Account = account;
                            });
                            allEvents.push(...eventsData.Events);
                        }
                    }
                } catch (error) {
                    console.log(`      ❌ Failed to get events from "${calendar.Summary}": ${error.message}`);
                }
            }
        }

        // Deduplicate: when events share the same start+end time, keep the
        // one with more information (has a title). This handles the home
        // calendar mirroring work events without titles.
        allEvents = deduplicateEvents(allEvents);

        // Sort all events by start time
        allEvents.sort((a, b) => {
            const timeA = new Date(a.Start);
            const timeB = new Date(b.Start);
            return timeA - timeB;
        });

        // Display which day we're showing
        let dayLabel;
        if (DAY_OFFSET !== null) {
            dayLabel = DAY_OFFSET === 0 ? "TODAY"
                : DAY_OFFSET === 1 ? "TOMORROW"
                : `+${DAY_OFFSET} DAYS`;
        } else {
            dayLabel = now.getHours() >= 17 ? "TOMORROW" : "TODAY";
        }
        const dayName = targetDate.toLocaleDateString('en-US', { weekday: 'short' });
        const monthDay = targetDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

        console.log(`\n:: ${dayLabel} - ${dayName} ${monthDay} ::`);

        if (allEvents.length > 0) {
            console.log('\n' + formatEventsTable(allEvents));

            return {
                success: true,
                eventsCount: allEvents.length,
                date: targetDate.toLocaleDateString(),
                events: allEvents,
                calendarsChecked: accounts.length
            };

        } else {
            console.log("\n🎉 No events scheduled");
            return {
                success: true,
                eventsCount: 0,
                date: targetDate.toLocaleDateString(),
                events: [],
                calendarsChecked: accounts.length,
                calendarSummary: {}
            };
        }

    } catch (error) {
        console.error("❌ Failed to get tomorrow's events:", error.message);
        return {error: error.message};
    }
}

/**
 * "Mon, 14 Sep 2026 11:15:57 +0000" -> "Sep 14  7:15am" in local time,
 * padded so the subjects line up. Unparsable dates yield blank padding.
 */
function formatMessageDate(rawDate) {
    const width = 15;
    const date = rawDate ? new Date(rawDate) : null;
    if (!date || isNaN(date)) return ' '.repeat(width);

    const day = date.toLocaleDateString('en-US', { month: 'short', day: '2-digit' });
    const time = date
        .toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
        .replace(' ', '')
        .toLowerCase();
    return `${day} ${time.padStart(7)}`.padEnd(width);
}

/**
 * List inbox subjects for the work Google account.
 * Read-only; a failure here must never stop the alarms from being set.
 */
async function showWorkEmail(mcpManager) {
    try {
        const data = await mcpManager.callToolJson('google-calendar', 'list_messages', {
            account: EMAIL_ACCOUNT,
            query: 'in:inbox',
            maxResults: EMAIL_COUNT
        });

        if (data.error) {
            console.log(`\n:: EMAIL ::\n\n   \u26a0\ufe0f  ${data.error}`);
            return;
        }

        console.log(`\n:: EMAIL - ${data.UserEmail} ::\n`);

        const messages = data.Messages || [];
        if (messages.length === 0) {
            console.log('   \ud83c\udf89 Inbox empty');
            return;
        }

        for (const message of messages) {
            const marker = message.IsUnread ? '\u2022' : ' ';
            console.log(` ${marker} ${formatMessageDate(message.Date)}  ${message.Subject || '(no subject)'}`);
        }
    } catch (error) {
        console.log(`\n:: EMAIL ::\n\n   \u26a0\ufe0f  Failed to read mail: ${error.message}`);
    }
}

/**
 * Set a wake-up alarm, an exercise alarm, and one 5 minutes before each timed event.
 */
async function setAlarmsForEvents(events) {
    const deviceId = getConnectedDevice();
    await setAlarm(deviceId, 7, 30, "wake up");
    await setAlarm(deviceId, 12, 0, "exercise");
    for (const event of events) {
        if (isAllDay(event)) continue;
        const calLabel = event.IsPrimary ? event.Account : event.CalendarName.split('@')[0];
        if (calLabel === 'crystal') continue;
        const startTimeBefore = new Date(event.Start);
        startTimeBefore.setMinutes(startTimeBefore.getMinutes() - 5);
        await setAlarm(deviceId, startTimeBefore.getHours(), startTimeBefore.getMinutes(), event.Summary || 'No title');
    }
}

/**
 * The daily briefing: calendar, then mail, then alarms. Alarms go last because
 * each one costs a two second pause on the phone.
 */
async function dailyBriefing(mcpManager) {
    const result = await showTomorrowEvents(mcpManager);

    if (!NO_EMAIL) {
        await showWorkEmail(mcpManager);
    }

    if (!NO_ALARM && result.events && result.events.length > 0) {
        await setAlarmsForEvents(result.events);
    }

    return result;
}

function getConnectedDevice() {
    try {
        const devicesOutput = execFileSync(ADB_PATH, ['devices'], { encoding: 'utf8' });

        // Parse the output to find connected devices
        const lines = devicesOutput.split('\n');
        const notReady = [];
        for (const line of lines) {
            // Skip header and empty lines
            if (line.includes('List of devices') || !line.trim()) continue;

            // Device line format: "device_id    state"
            const match = line.match(/^(\S+)\s+(\S+)/);
            if (!match) continue;
            if (match[2] === 'device') {
                return match[1];
            }
            notReady.push({ id: match[1], state: match[2] });
        }

        if (notReady.length > 0) {
            const hints = {
                unauthorized: 'unlock the phone and accept the "Allow USB debugging?" prompt (check "Always allow"); if no prompt appears, toggle USB debugging off and on in Developer options to make it reappear',
                offline: 'replug the cable or run "adb kill-server" and try again',
            };
            const details = notReady
                .map(({ id, state }) => `${id} is ${state}${hints[state] ? ` — ${hints[state]}` : ''}`)
                .join('; ');
            throw new Error(`Phone connected but not ready: ${details}`);
        }

        throw new Error('No device connected');
    } catch (error) {
        console.error('Failed to get connected device:', error.message);
        throw error;
    }
}

async function setAlarm(deviceId, hour, minute, message) {
    // Strip shell metacharacters to prevent command injection via event titles
    const safeMessage = message.replace(/["`$\\;|&<>(){}[\]!#~*?]/g, '');

    const amCommand = `am start -a android.intent.action.SET_ALARM --ei android.intent.extra.alarm.HOUR ${hour} --ei android.intent.extra.alarm.MINUTES ${minute} --es android.intent.extra.alarm.MESSAGE "${safeMessage}" --ez android.intent.extra.alarm.VIBRATE true`;

    execFileSync(ADB_PATH, [
        '-s', deviceId, 'shell',
        amCommand
    ], { encoding: 'utf8' });

    // Wait for the Android alarm UI to settle before sending the next intent
    await new Promise(resolve => setTimeout(resolve, 2000));
}

async function main() {
    const runner = new WorkflowRunner(CONFIG.servers);

    try {
        await runner.run(dailyBriefing);
        console.log();
    } catch (error) {
        console.error("Script failed:", error);
        process.exit(1);
    }
    process.exit(0);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
    main();
}

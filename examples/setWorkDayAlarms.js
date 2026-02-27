import {WorkflowRunner} from '../index.js';
import {execFileSync} from 'child_process';
import CONFIG from '../config.js';

// Parse command line arguments
const args = process.argv.slice(2);
const NO_ALARM = args.includes('-na') || args.includes('--no-alarm');

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

        // If after 5pm, use tomorrow's date, otherwise use today's date
        if (now.getHours() >= 17) {
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
        const dayLabel = now.getHours() >= 17 ? "TOMORROW" : "TODAY";
        const dayName = targetDate.toLocaleDateString('en-US', { weekday: 'short' });
        const monthDay = targetDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

        console.log(`\n:: ${dayLabel} - ${dayName} ${monthDay} ::`);

        if (allEvents.length > 0) {
            console.log('\n' + formatEventsTable(allEvents));

            // Set alarms on phone after displaying the table
            if (!NO_ALARM) {
                const deviceId = getConnectedDevice();
                await setAlarm(deviceId, 7, 30, "wake up");
                await setAlarm(deviceId, 12, 0, "exercise");
                for (const event of allEvents) {
                    if (isAllDay(event)) continue;
                    const calLabel = event.IsPrimary ? event.Account : event.CalendarName.split('@')[0];
                    if (calLabel === 'crystal') continue;
                    const startTimeBefore = new Date(event.Start);
                    startTimeBefore.setMinutes(startTimeBefore.getMinutes() - 5);
                    await setAlarm(deviceId, startTimeBefore.getHours(), startTimeBefore.getMinutes(), event.Summary || 'No title');
                }
            }

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

function getConnectedDevice() {
    try {
        const adbPath = `${process.env.HOME}/Library/Android/sdk/platform-tools/adb`;
        const devicesOutput = execFileSync(adbPath, ['devices'], { encoding: 'utf8' });

        // Parse the output to find connected devices
        const lines = devicesOutput.split('\n');
        for (const line of lines) {
            // Skip header and empty lines
            if (line.includes('List of devices') || !line.trim()) continue;

            // Device line format: "device_id    device"
            const match = line.match(/^(\S+)\s+device$/);
            if (match) {
                return match[1];
            }
        }

        throw new Error('No device connected');
    } catch (error) {
        console.error('Failed to get connected device:', error.message);
        throw error;
    }
}

async function setAlarm(deviceId, hour, minute, message) {
    const adbPath = `${process.env.HOME}/Library/Android/sdk/platform-tools/adb`;

    execFileSync(adbPath, [
        '-s', deviceId, 'shell',
        'am', 'start',
        '-a', 'android.intent.action.SET_ALARM',
        '--ei', 'android.intent.extra.alarm.HOUR', String(hour),
        '--ei', 'android.intent.extra.alarm.MINUTES', String(minute),
        '--es', 'android.intent.extra.alarm.MESSAGE', message,
        '--ez', 'android.intent.extra.alarm.VIBRATE', 'true'
    ], { encoding: 'utf8' });

    await new Promise(resolve => setTimeout(resolve, 2000));
}

async function main() {
    const runner = new WorkflowRunner(CONFIG.servers);

    try {
        await runner.run(showTomorrowEvents);
    } catch (error) {
        console.error("Script failed:", error);
        process.exit(1);
    }
    process.exit(0);
}

if (import.meta.url === `file://${process.argv[1]}`) {
    main();
}

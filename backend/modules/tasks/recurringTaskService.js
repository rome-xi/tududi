const moment = require('moment-timezone');
const { getWeekdayInTimezone } = require('../../utils/timezone-utils');

const calculateNextDueDate = (task, fromDate, timezone = 'UTC') => {
    if (
        !task ||
        !task.recurrence_type ||
        !fromDate ||
        isNaN(fromDate.getTime())
    ) {
        return null;
    }

    const startDate = new Date(fromDate.getTime());

    switch (task.recurrence_type) {
        case 'daily':
            return calculateDailyRecurrence(
                startDate,
                task.recurrence_interval || 1
            );

        case 'weekly':
            return calculateWeeklyRecurrence(
                startDate,
                task.recurrence_interval || 1,
                task.recurrence_weekday,
                task.recurrence_weekdays,
                timezone
            );

        case 'monthly':
            return calculateMonthlyRecurrence(
                startDate,
                task.recurrence_interval || 1,
                task.recurrence_month_day,
                timezone
            );

        case 'monthly_weekday':
            return calculateMonthlyWeekdayRecurrence(
                startDate,
                task.recurrence_interval || 1,
                task.recurrence_weekday,
                task.recurrence_week_of_month,
                timezone
            );

        case 'monthly_last_day':
            return calculateMonthlyLastDayRecurrence(
                startDate,
                task.recurrence_interval || 1,
                timezone
            );

        default:
            return null;
    }
};

const calculateDailyRecurrence = (fromDate, interval) => {
    const nextDate = new Date(fromDate);
    nextDate.setUTCDate(nextDate.getUTCDate() + interval);
    return nextDate;
};

const calculateWeeklyRecurrence = (
    fromDate,
    interval,
    weekday,
    weekdays,
    timezone = 'UTC'
) => {
    const nextDate = new Date(fromDate);

    // Handle multiple weekdays (e.g. Tuesday AND Thursday)
    const parsedWeekdays = weekdays
        ? Array.isArray(weekdays)
            ? weekdays
            : JSON.parse(weekdays)
        : null;

    if (parsedWeekdays && parsedWeekdays.length > 0) {
        const sorted = [...parsedWeekdays].sort((a, b) => a - b);
        // Read the weekday in the user's timezone, not getUTCDay(): fromDate
        // may represent "local midnight" as a UTC instant, whose UTC calendar
        // day is the previous day for positive-UTC-offset timezones.
        const currentDay = getWeekdayInTimezone(nextDate, timezone);

        // Find next weekday in calendar order (accounting for week wrap)
        let nextWeekday = null;
        let daysToNext = null;

        for (let i = 1; i <= 7; i++) {
            const testDay = (currentDay + i) % 7;
            if (sorted.includes(testDay)) {
                nextWeekday = testDay;
                daysToNext = i;
                break;
            }
        }

        if (daysToNext === null) {
            // No weekday found (shouldn't happen), fallback
            daysToNext = interval * 7;
        } else if (daysToNext < 7) {
            // Next weekday is within current 7-day period
            // Determine if we should skip weeks based on interval
            const isAdjacentDay = daysToNext === 1;

            // Determine if current day is the last weekday in the pattern
            // (considering calendar order, where the highest day number is last,
            // except Sunday(0) which wraps around)
            const maxWeekday = Math.max(...sorted);
            const isOnLastWeekday = currentDay === maxWeekday;

            // Special case: if pattern includes Sunday(0), check if we're on it
            // and all other weekdays are higher (meaning we're at the end of the pattern)
            const hasSunday = sorted.includes(0);
            const isOnSundayWithHigherDays =
                currentDay === 0 && sorted.every((d) => d === 0 || d > 0);

            if (
                interval > 1 &&
                !isAdjacentDay &&
                (isOnLastWeekday || isOnSundayWithHigherDays)
            ) {
                // We're on the last weekday of the pattern cycle, add interval skip
                daysToNext += (interval - 1) * 7;
            }
        } else {
            // Next occurrence is 7 days away, add interval skip
            daysToNext += (interval - 1) * 7;
        }

        nextDate.setUTCDate(nextDate.getUTCDate() + daysToNext);
    } else if (weekday !== null && weekday !== undefined) {
        const currentWeekday = getWeekdayInTimezone(nextDate, timezone);
        let daysUntilTarget = (weekday - currentWeekday + 7) % 7;

        if (daysUntilTarget === 0) {
            daysUntilTarget = interval * 7;
        } else if (interval > 1 && daysUntilTarget < 7) {
            daysUntilTarget += (interval - 1) * 7;
        }

        nextDate.setUTCDate(nextDate.getUTCDate() + daysUntilTarget);
    } else {
        nextDate.setUTCDate(nextDate.getUTCDate() + interval * 7);
    }

    return nextDate;
};

// Due dates are stored as the end of the user's local day. West of UTC that
// instant is already the next UTC day, so UTC getters would read the wrong
// month. Work in the user's timezone and copy the local wall-clock time.
const zonedFrom = (fromDate, timezone) =>
    moment.tz(fromDate, timezone || 'UTC');

// Add months by year/month arithmetic. setUTCMonth overflows day 29-31 of a
// long month into the month after a short one (Jan 30 + 1 month -> March).
const addCalendarMonths = (year, monthIndex, interval) => {
    const totalMonths = monthIndex + interval;
    return {
        year: year + Math.floor(totalMonths / 12),
        month: totalMonths % 12,
    };
};

const daysInMonth = (year, monthIndex, timezone) =>
    moment.tz({ year, month: monthIndex, date: 1 }, timezone).daysInMonth();

const zonedDateFromTemplate = (year, monthIndex, day, template) => {
    const month = String(monthIndex + 1).padStart(2, '0');
    const dayOfMonth = String(day).padStart(2, '0');
    const zone = template.tz() || 'UTC';
    return moment
        .tz(
            `${year}-${month}-${dayOfMonth} ${template.format('HH:mm:ss.SSS')}`,
            'YYYY-MM-DD HH:mm:ss.SSS',
            true,
            zone
        )
        .toDate();
};

const calculateMonthlyRecurrence = (
    fromDate,
    interval,
    dayOfMonth,
    timezone = 'UTC'
) => {
    const from = zonedFrom(fromDate, timezone);
    const targetDay = dayOfMonth || from.date();
    const { year, month } = addCalendarMonths(
        from.year(),
        from.month(),
        interval
    );
    const finalDay = Math.min(targetDay, daysInMonth(year, month, timezone));

    return zonedDateFromTemplate(year, month, finalDay, from);
};

const calculateMonthlyWeekdayRecurrence = (
    fromDate,
    interval,
    weekday,
    weekOfMonth,
    timezone = 'UTC'
) => {
    const from = zonedFrom(fromDate, timezone);
    const { year, month } = addCalendarMonths(
        from.year(),
        from.month(),
        interval
    );

    const firstOfMonth = moment.tz({ year, month, date: 1 }, timezone);
    const daysToAdd = (weekday - firstOfMonth.day() + 7) % 7;
    let day = 1 + daysToAdd + (weekOfMonth - 1) * 7;

    // A 5th weekday does not exist in every month. Step back one week,
    // which is the last occurrence of that weekday.
    if (day > firstOfMonth.daysInMonth()) {
        day -= 7;
    }

    return zonedDateFromTemplate(year, month, day, from);
};

const calculateMonthlyLastDayRecurrence = (
    fromDate,
    interval,
    timezone = 'UTC'
) => {
    const from = zonedFrom(fromDate, timezone);
    const { year, month } = addCalendarMonths(
        from.year(),
        from.month(),
        interval
    );

    return zonedDateFromTemplate(
        year,
        month,
        daysInMonth(year, month, timezone),
        from
    );
};

const getFirstWeekdayOfMonth = (year, month, weekday) => {
    const firstOfMonth = new Date(year, month, 1);
    const firstWeekday = firstOfMonth.getDay();
    const daysToAdd = (weekday - firstWeekday + 7) % 7;
    return new Date(year, month, 1 + daysToAdd);
};

const getLastWeekdayOfMonth = (year, month, weekday) => {
    const lastOfMonth = new Date(year, month + 1, 0);
    const lastWeekday = lastOfMonth.getDay();
    const daysToSubtract = (lastWeekday - weekday + 7) % 7;
    return new Date(year, month, lastOfMonth.getDate() - daysToSubtract);
};

const getNthWeekdayOfMonth = (year, month, weekday, n) => {
    const firstOccurrence = getFirstWeekdayOfMonth(year, month, weekday);
    const targetDate = new Date(firstOccurrence);
    targetDate.setDate(firstOccurrence.getDate() + (n - 1) * 7);

    if (targetDate.getMonth() !== month) {
        return null;
    }

    return targetDate;
};

const shouldGenerateNextTask = (task, nextDate) => {
    if (!task.recurrence_end_date) {
        return true;
    }
    return nextDate < task.recurrence_end_date;
};

const calculateVirtualOccurrences = (
    task,
    count = 7,
    startFrom = null,
    userTimezone = 'UTC'
) => {
    const moment = require('moment-timezone');
    const occurrences = [];

    // Parse start date properly in user's timezone
    let currentDate;
    if (startFrom) {
        if (typeof startFrom === 'string') {
            // Parse date string in user's timezone
            currentDate = moment.tz(startFrom, userTimezone).toDate();
        } else {
            currentDate = new Date(startFrom);
        }
    } else if (task.due_date) {
        // Parse task due_date in UTC (since it comes from database)
        currentDate = new Date(task.due_date);
    } else {
        // Get current date in user's timezone
        currentDate = moment.tz(userTimezone).startOf('day').toDate();
    }

    let iterationCount = 0;
    const MAX_ITERATIONS = 100;

    while (occurrences.length < count && iterationCount < MAX_ITERATIONS) {
        if (
            task.recurrence_end_date &&
            currentDate > new Date(task.recurrence_end_date)
        ) {
            break;
        }

        // Date-only occurrences stay a calendar string. A timed occurrence
        // must keep the real instant: a YYYY-MM-DD string is parsed as UTC
        // midnight, so Upcoming would show that clock (00:00, or 12:00 in
        // UTC+12) instead of the stored due time.
        const dateInUserTz = moment
            .utc(currentDate)
            .tz(userTimezone)
            .format('YYYY-MM-DD');

        occurrences.push({
            due_date: task.due_has_time ? new Date(currentDate) : dateInUserTz,
            is_virtual: true,
        });

        if (task.due_has_time) {
            // For timed recurrences, advance the calendar date using local
            // calendar arithmetic in userTimezone so advancing days/weeks is
            // immune to UTC hour shifts across DST (e.g. 00:30 on the autumn
            // fall-back day). Then rebuild the next instant with the parent's
            // local wall-clock time.
            const currentLocal = moment.tz(currentDate, userTimezone);
            let nextDateInUserTz;
            if (task.recurrence_type === 'daily') {
                nextDateInUserTz = currentLocal
                    .add(task.recurrence_interval || 1, 'days')
                    .format('YYYY-MM-DD');
            } else if (
                task.recurrence_type === 'weekly' &&
                !task.recurrence_weekdays &&
                (task.recurrence_weekday === null ||
                    task.recurrence_weekday === undefined ||
                    task.recurrence_weekday === currentLocal.day())
            ) {
                nextDateInUserTz = currentLocal
                    .add(task.recurrence_interval || 1, 'weeks')
                    .format('YYYY-MM-DD');
            } else {
                const localMidday = moment
                    .tz(
                        `${currentLocal.format('YYYY-MM-DD')} 12:00:00`,
                        'YYYY-MM-DD HH:mm:ss',
                        userTimezone
                    )
                    .toDate();
                const nextMidday = calculateNextDueDate(
                    task,
                    localMidday,
                    userTimezone
                );
                if (!nextMidday) break;
                nextDateInUserTz = moment(nextMidday)
                    .tz(userTimezone)
                    .format('YYYY-MM-DD');
            }

            const parentInstant = task.due_date
                ? moment.utc(task.due_date)
                : moment.utc(startFrom || currentDate);
            const parentLocal = parentInstant.tz(userTimezone);
            currentDate = moment
                .tz(
                    `${nextDateInUserTz} ${parentLocal.format('HH:mm:ss.SSS')}`,
                    'YYYY-MM-DD HH:mm:ss.SSS',
                    userTimezone
                )
                .toDate();
        } else {
            currentDate = calculateNextDueDate(task, currentDate, userTimezone);
            if (!currentDate) break;
        }

        iterationCount++;
    }

    return occurrences;
};

module.exports = {
    calculateNextDueDate,
    calculateDailyRecurrence,
    calculateWeeklyRecurrence,
    calculateMonthlyRecurrence,
    calculateMonthlyWeekdayRecurrence,
    calculateMonthlyLastDayRecurrence,
    calculateVirtualOccurrences,
    shouldGenerateNextTask,
    getFirstWeekdayOfMonth,
    getLastWeekdayOfMonth,
    getNthWeekdayOfMonth,
    _getFirstWeekdayOfMonth: getFirstWeekdayOfMonth,
    _getLastWeekdayOfMonth: getLastWeekdayOfMonth,
    _getNthWeekdayOfMonth: getNthWeekdayOfMonth,
    _shouldGenerateNextTask: shouldGenerateNextTask,
};

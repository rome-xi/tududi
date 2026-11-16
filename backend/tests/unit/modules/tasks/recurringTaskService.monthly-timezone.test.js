const {
    calculateNextDueDate,
} = require('../../../../modules/tasks/recurringTaskService');
const {
    processDueDateForStorage,
    processDueDateForResponse,
} = require('../../../../utils/timezone-utils');

// Storage writes the end of the user's local day. West of UTC that instant
// is already the next UTC calendar day, so monthly helpers that read UTC
// month and day walk the wrong date. Issue #2100.
function localDueDates(task, startDate, timezone, steps) {
    let cursor = processDueDateForStorage(startDate, timezone);
    const dates = [processDueDateForResponse(cursor, timezone)];

    for (let i = 0; i < steps; i++) {
        cursor = calculateNextDueDate(task, cursor, timezone);
        dates.push(processDueDateForResponse(cursor, timezone));
    }

    return dates;
}

describe('RecurringTaskService - Monthly Recurrence Timezone Awareness (issue #2100)', () => {
    describe('monthly on a day of the month', () => {
        const task = {
            recurrence_type: 'monthly',
            recurrence_interval: 1,
            recurrence_month_day: 1,
        };

        it('keeps the 1st of the month in America/New_York', () => {
            expect(
                localDueDates(task, '2026-04-01', 'America/New_York', 3)
            ).toEqual(['2026-04-01', '2026-05-01', '2026-06-01', '2026-07-01']);
        });

        it('keeps the 1st of the month in UTC', () => {
            expect(localDueDates(task, '2026-04-01', 'UTC', 3)).toEqual([
                '2026-04-01',
                '2026-05-01',
                '2026-06-01',
                '2026-07-01',
            ]);
        });

        it('keeps the 1st of the month in a positive-offset timezone (Asia/Kolkata)', () => {
            expect(
                localDueDates(task, '2026-04-01', 'Asia/Kolkata', 3)
            ).toEqual(['2026-04-01', '2026-05-01', '2026-06-01', '2026-07-01']);
        });
    });

    describe('monthly on the 31st across February', () => {
        const task = {
            recurrence_type: 'monthly',
            recurrence_interval: 1,
            recurrence_month_day: 31,
        };

        it('clamps February instead of skipping it in America/New_York', () => {
            expect(
                localDueDates(task, '2026-01-31', 'America/New_York', 2)
            ).toEqual(['2026-01-31', '2026-02-28', '2026-03-31']);
        });

        it('clamps February in UTC', () => {
            expect(localDueDates(task, '2026-01-31', 'UTC', 2)).toEqual([
                '2026-01-31',
                '2026-02-28',
                '2026-03-31',
            ]);
        });

        it('clamps February in a positive-offset timezone (Asia/Kolkata)', () => {
            expect(
                localDueDates(task, '2026-01-31', 'Asia/Kolkata', 2)
            ).toEqual(['2026-01-31', '2026-02-28', '2026-03-31']);
        });
    });

    describe('last Friday of the month (week_of_month 5)', () => {
        const task = {
            recurrence_type: 'monthly_weekday',
            recurrence_interval: 1,
            recurrence_weekday: 5,
            recurrence_week_of_month: 5,
        };

        it('lands in February instead of March when January 30 overflows in UTC', () => {
            expect(localDueDates(task, '2026-01-30', 'UTC', 1)).toEqual([
                '2026-01-30',
                '2026-02-27',
            ]);
        });

        it('lands in February instead of March when January 30 overflows in America/New_York', () => {
            expect(
                localDueDates(task, '2026-01-30', 'America/New_York', 1)
            ).toEqual(['2026-01-30', '2026-02-27']);
        });
    });

    describe('monthly on the last day', () => {
        const task = {
            recurrence_type: 'monthly_last_day',
            recurrence_interval: 1,
        };

        it('does not skip February in America/New_York', () => {
            expect(
                localDueDates(task, '2026-01-31', 'America/New_York', 2)
            ).toEqual(['2026-01-31', '2026-02-28', '2026-03-31']);
        });

        it('does not skip February in UTC', () => {
            expect(localDueDates(task, '2026-01-31', 'UTC', 2)).toEqual([
                '2026-01-31',
                '2026-02-28',
                '2026-03-31',
            ]);
        });
    });
});

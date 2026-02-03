const Subscription = require('../../../infrastructure/models/subscription');

async function deductPoints(userId, amount) {
    const normalizedAmount = Number(amount);
    if (!Number.isFinite(normalizedAmount) || normalizedAmount <= 0) {
        throw new Error('Invalid deduction amount');
    }

    const subscriptions = await Subscription
        .find({ userId })
        .sort({ subscriptionDate: 1 });   // oldest first

    let remaining = normalizedAmount;

    for (const sub of subscriptions) {
        if (remaining <= 0) break;

        const currentRemaining = Number.isFinite(sub.remainingPoints)
            ? sub.remainingPoints
            : 0;
        const currentConsumed = Number.isFinite(sub.consumedPoints)
            ? sub.consumedPoints
            : 0;

        const toDeduct = Math.min(currentRemaining, remaining);
        if (toDeduct <= 0) continue;

        sub.remainingPoints = currentRemaining - toDeduct;
        sub.consumedPoints = currentConsumed + toDeduct;

        await sub.save();

        remaining -= toDeduct;
    }

    if (remaining > 0) {
        throw new Error('Insufficient points across subscriptions');
    }

    const remainingPoints = subscriptions.reduce(
        (sum, sub) => sum + (Number.isFinite(sub.remainingPoints) ? sub.remainingPoints : 0),
        0
    );

    return { remainingPoints };
}

module.exports = deductPoints;

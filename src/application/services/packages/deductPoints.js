const Subscription = require('../../../infrastructure/models/subscription');

async function deductPoints(userId, amount) {
    if (amount <= 0) throw new Error('Invalid deduction amount');

    const subscriptions = await Subscription
        .find({ userId })
        .sort({ subscriptionDate: 1 });   // oldest first

    let remaining = amount;

    for (const sub of subscriptions) {
        if (remaining <= 0) break;

        const toDeduct = Math.min(sub.remainingPoints, remaining);

        sub.remainingPoints -= toDeduct;
        sub.consumedPoints += toDeduct;

        await sub.save();

        remaining -= toDeduct;
    }

    if (remaining > 0) {
        throw new Error('Insufficient points across subscriptions');
    }
}

module.exports = deductPoints;
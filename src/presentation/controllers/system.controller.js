const SystemState = require('../../infrastructure/models/systemState');

const VALID_MODES = ['active', 'inactive', 'partial', 'demo'];

exports.getSystemState = async (req, res) => {
    try {
        const state = await SystemState.getSingleton();
        res.json(state);
    } catch (error) {
        res.status(500).json({ message: 'Failed to load system state', error: error.message });
    }
};

exports.updateSystemState = async (req, res) => {
    const { mode, expectedReturn, downtimeDays, downtimeHours, notes, allowedModules, partialMessage } = req.body;
    try {
        if (mode && !VALID_MODES.includes(mode)) {
            return res.status(400).json({ message: 'Invalid mode supplied' });
        }

        const state = await SystemState.getSingleton();

        if (mode) state.mode = mode;
        if (typeof downtimeDays === 'number' || typeof downtimeDays === 'string') {
            const parsed = Number(downtimeDays);
            if (Number.isNaN(parsed) || parsed < 0) {
                return res.status(400).json({ message: 'downtimeDays must be a positive number' });
            }
            state.downtimeDays = parsed;
        }

        if (typeof downtimeHours === 'number' || typeof downtimeHours === 'string') {
            const parsed = Number(downtimeHours);
            if (Number.isNaN(parsed) || parsed < 0) {
                return res.status(400).json({ message: 'downtimeHours must be a positive number' });
            }
            state.downtimeHours = parsed;
        }
        state.notes = typeof notes === 'string' ? notes : state.notes;
        state.partialMessage = typeof partialMessage === 'string' ? partialMessage : state.partialMessage;

        if (expectedReturn === null) {
            state.expectedReturn = null;
        } else if (expectedReturn) {
            const asDate = new Date(expectedReturn);
            if (Number.isNaN(asDate.getTime())) {
                return res.status(400).json({ message: 'expectedReturn must be a valid date' });
            }
            state.expectedReturn = asDate;
        }

        if (Array.isArray(allowedModules) && (mode === 'partial' || mode === 'demo')) {
            state.allowedModules = allowedModules.filter(Boolean);
        } else if (mode && mode !== 'partial' && mode !== 'demo') {
            state.allowedModules = [];
        }

        state.updatedBy = req.userId || state.updatedBy;
        state.updatedByPhone = req.user?.phone || state.updatedByPhone;
        state.updatedAt = new Date();
        await state.save();

        res.json(state);
    } catch (error) {
        res.status(500).json({ message: 'Failed to update system state', error: error.message });
    }
};

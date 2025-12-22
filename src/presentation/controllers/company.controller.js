const bcrypt = require('bcryptjs');
const User = require('../../infrastructure/models/user');

const ensureCompanyHead = async (userId) => {
    const user = await User.findById(userId);
    if (!user) {
        throw new Error('User not found');
    }

    const isHead = user.type === 'company' || user.role === 'company-head';
    if (!isHead) {
        throw new Error('Only company heads can manage members');
    }

    if (!user.company) {
        throw new Error('Company is not linked to this account');
    }

    return user;
};

exports.listMembers = async (req, res) => {
    try {
        const head = await ensureCompanyHead(req.user.id);
        const members = await User.find({ company: head.company, role: 'member' })
            .select('_id phone displayName permissions createdAt');

        res.json({ members });
    } catch (err) {
        const status = err.message.includes('Only company heads') ? 403 : 400;
        res.status(status).json({ message: err.message });
    }
};

exports.createMember = async (req, res) => {
    try {
        const head = await ensureCompanyHead(req.user.id);
        const { phone, password, displayName, permissions } = req.body;

        if (!phone || !password) {
            return res.status(400).json({ message: 'Phone and password are required.' });
        }

        const existing = await User.findOne({ phone });
        if (existing) {
            return res.status(409).json({ message: 'User already exists.' });
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        const member = new User({
            phone,
            password: hashedPassword,
            type: 'individual',
            role: 'member',
            company: head.company,
            permissions: Array.isArray(permissions) ? permissions : [],
            displayName
        });

        await member.save();

        res.status(201).json({
            message: 'Member created',
            member: {
                _id: member._id,
                phone: member.phone,
                displayName: member.displayName,
                permissions: member.permissions
            }
        });
    } catch (err) {
        const status = err.message.includes('Only company heads') ? 403 : 400;
        res.status(status).json({ message: err.message });
    }
};

exports.updateMember = async (req, res) => {
    try {
        const head = await ensureCompanyHead(req.user.id);
        const { id } = req.params;
        const { phone, password, displayName, permissions } = req.body;

        const member = await User.findById(id);
        if (!member || String(member.company) !== String(head.company)) {
            return res.status(404).json({ message: 'Member not found.' });
        }

        if (phone && phone !== member.phone) {
            const duplicate = await User.findOne({ phone, _id: { $ne: member._id } });
            if (duplicate) {
                return res.status(409).json({ message: 'Phone already in use.' });
            }
            member.phone = phone;
        }

        if (password) {
            member.password = await bcrypt.hash(password, 10);
        }

        if (displayName !== undefined) {
            member.displayName = displayName;
        }

        if (permissions !== undefined) {
            member.permissions = Array.isArray(permissions) ? permissions : [];
        }

        await member.save();

        res.json({
            message: 'Member updated',
            member: {
                _id: member._id,
                phone: member.phone,
                displayName: member.displayName,
                permissions: member.permissions
            }
        });
    } catch (err) {
        const status = err.message.includes('Only company heads') ? 403 : 400;
        res.status(status).json({ message: err.message });
    }
};

exports.deleteMember = async (req, res) => {
    try {
        const head = await ensureCompanyHead(req.user.id);
        const { id } = req.params;
        const member = await User.findById(id);

        if (!member || String(member.company) !== String(head.company)) {
            return res.status(404).json({ message: 'Member not found.' });
        }

        await member.deleteOne();
        res.json({ message: 'Member removed' });
    } catch (err) {
        const status = err.message.includes('Only company heads') ? 403 : 400;
        res.status(status).json({ message: err.message });
    }
};

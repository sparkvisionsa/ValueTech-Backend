const bcrypt = require('bcrypt');
const User = require('../infrastructure/models/user');

const register = async (req, res) => {
    const { phone, password, type } = req.body;

    if (!phone || !password) {
        return res.status(400).json({ message: 'Phone and password are required' });
    }

    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        const user = new User({ phone, password: hashedPassword, type });
        await user.save();
        res.status(201).json({ message: 'User registered successfully' });
    } catch (error) {
        if (error.code === 11000) {
            res.status(409).json({ message: 'Phone number already exists' });
        } else {
            res.status(500).json({ message: 'Internal server error' });
        }
    }
};

module.exports = { register };
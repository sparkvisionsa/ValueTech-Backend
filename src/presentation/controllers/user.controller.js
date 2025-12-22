const bcrypt = require('bcryptjs');
const User = require('../../infrastructure/models/user');
const Company = require('../../infrastructure/models/company');

const { generateAccessToken, generateRefreshToken } = require('../../application/services/user/jwt.service');

exports.register = async (req, res) => {
    try {
        const { phone, password, type, companyName, companyHead } = req.body;

        if (!phone || !password) {
            return res.status(400).json({ message: 'Phone and password are required.' });
        }

        if (type === 'company' && (!companyName || !companyHead)) {
            return res.status(400).json({ message: 'Company name and head are required for company accounts.' });
        }

        const existingUser = await User.findOne({ phone });
        if (existingUser) {
            return res.status(409).json({ message: 'User already exists.' });
        }

        const hashedPassword = await bcrypt.hash(password, 10);

        let companyDoc = null;
        let user;

        if (type === 'company') {
            // Create the head user first so we can reference it from the company doc
            user = new User({
                phone,
                password: hashedPassword,
                type: 'company',
                role: 'company-head',
                headName: companyHead,
                companyName
            });
            await user.save();

            companyDoc = new Company({
                name: companyName,
                headName: companyHead,
                phone,
                headUser: user._id
            });
            await companyDoc.save();

            user.company = companyDoc._id;
            await user.save();
        } else {
            user = new User({
                phone,
                password: hashedPassword,
                type: 'individual',
                role: 'individual'
            });
            await user.save();
        }

        const payload = {
            id: user._id.toString(),
            phone: user.phone,
            type: user.type,
            role: user.role,
            company: user.company || null,
            permissions: user.permissions || []
        };
        const accessToken = generateAccessToken(payload);
        const refreshToken = generateRefreshToken(payload);

        res.cookie('refreshToken', refreshToken, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'Strict',
            maxAge: 7 * 24 * 60 * 60 * 1000
        });

        res.status(201).json({
            message: 'User registered successfully.',
            token: accessToken,
            refreshToken,
            user: {
                _id: user._id,
                phone: user.phone,
                type: user.type,
                role: user.role,
                company: user.company,
                companyName: user.companyName,
                headName: user.headName,
                permissions: user.permissions,
                createdAt: user.createdAt
            }
        });
    } catch (err) {
        res.status(500).json({ message: 'Server error', error: err.message });
    }
};


exports.login = async (req, res) => {
  try {
    const { phone, password } = req.body;
    if (!phone || !password) return res.status(400).json({ message: 'Phone and password are required.' });

    const user = await User.findOne({ phone });
    if (!user) return res.status(404).json({ message: 'User not found.' });

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(401).json({ message: 'Invalid credentials.' });

    const payload = {
        id: user._id.toString(),
        phone: user.phone,
        type: user.type,
        role: user.role,
        company: user.company || null,
        permissions: user.permissions || []
    };
    const accessToken = generateAccessToken(payload);
    const refreshToken = generateRefreshToken(payload);

    // Set HttpOnly cookie (also okay — main process can read Set-Cookie header or use returned token)
    res.cookie('refreshToken', refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'Strict',
      maxAge: 7 * 24 * 60 * 60 * 1000
    });

    return res.status(200).json({
      message: 'Login successful.',
      token: accessToken,
      refreshToken, // <-- optional: helpful for main process to set cookie
      user: {
        _id: user._id,
        phone: user.phone,
        type: user.type,
        role: user.role,
        company: user.company,
        companyName: user.companyName,
        headName: user.headName,
        permissions: user.permissions,
        createdAt: user.createdAt
      }
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Server error', error: err.message });
  }
};
const bcrypt = require('bcryptjs');
const User = require('../../infrastructure/models/user');
const Company = require('../../infrastructure/models/company');

const { generateAccessToken, generateRefreshToken } = require('../../application/services/user/jwt.service');

exports.register = async (req, res) => {
    try {
        const { phone, password, type, companyName, companyHead, taqeemUsername } = req.body;

        if (!phone || !password) {
            return res.status(400).json({ message: 'Phone and password are required.' });
        }

        if (type === 'company' && (!companyName || !companyHead)) {
            return res.status(400).json({ message: 'Company name and head are required for company accounts.' });
        }

        // Check if user with this phone already exists
        const existingUserByPhone = await User.findOne({ phone });
        if (existingUserByPhone) {
            return res.status(409).json({ message: 'User with this phone number already exists.' });
        }

        // If taqeemUsername is provided, look for existing user with that username
        let existingUserByTaqeem = null;
        if (taqeemUsername && taqeemUsername.trim() !== '') {
            existingUserByTaqeem = await User.findOne({ 'taqeem.username': taqeemUsername.trim() });
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        let companyDoc = null;
        let user;

        // If user exists with taqeem username, update that user instead of creating new
        if (existingUserByTaqeem) {
            user = existingUserByTaqeem;

            const alreadyRegistered = user.phone

            if (alreadyRegistered) {
                return res.status(409).json({
                    message: 'User with this Taqeem account already exists.'
                });
            }

            // Update user fields
            user.phone = phone;
            user.password = hashedPassword;
            user.type = type;

            // Update role based on type
            if (type === 'company') {
                user.role = 'company-head';
                user.headName = companyHead;
                user.companyName = companyName;

                // Create company if user is registering as company
                companyDoc = new Company({
                    name: companyName,
                    headName: companyHead,
                    phone,
                    headUser: user._id
                });
                await companyDoc.save();

                user.company = companyDoc._id;
            } else {
                user.role = 'individual';
                // Clear company-related fields if switching from company to individual
                user.company = null;
                user.companyName = undefined;
                user.headName = undefined;
            }

            await user.save();
        } else {
            // Create new user (original logic)
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

            // If taqeemUsername was provided but no user found, you might want to create taqeem field
            // or handle it differently based on your requirements
            // For now, we'll just store it if provided
            if (taqeemUsername && taqeemUsername.trim() !== '') {
                user.taqeem = user.taqeem || {};
                user.taqeem.username = taqeemUsername.trim();
                // Note: taqeem.password is required in schema, you might need to handle this
                await user.save();
            }
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
            message: existingUserByTaqeem ? 'User account linked and updated successfully.' : 'User registered successfully.',
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
                taqeem: user.taqeem,
                permissions: user.permissions,
                createdAt: user.createdAt,
                updatedAt: user.updatedAt
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


exports.taqeemBootstrap = async (req, res) => {
    try {

        const { username, password } = req.body;

        if (req.userId) {
            return res.json({
                status: "NORMAL_ACCOUNT",
                userId: req.userId
            });
        }

        let user = await User.findOne({ "taqeem.username": username });

        // CASE 1 — first time ever → create user + send token  
        if (!user) {
            user = await User.create({
                taqeem: {
                    username,
                    password,
                    bootstrap_used: false,
                }
            });

            const payload = {
                id: user._id.toString(),
                phone: user.phone || null,
                type: user.type || "taqeem",
                role: user.role || "user",
                company: user.company || null,
                permissions: user.permissions || []
            };

            const accessToken = generateAccessToken(payload);
            const refreshToken = generateRefreshToken(payload);

            res.cookie("refreshToken", refreshToken, {
                httpOnly: true,
                secure: process.env.NODE_ENV === "production",
                sameSite: "Strict",
                maxAge: 7 * 24 * 60 * 60 * 1000
            });

            return res.json({
                status: "BOOTSTRAP_GRANTED",
                token: accessToken,
                refreshToken,
                userId: user._id,
            });
        }

        // CASE 2 — username exists but password mismatch → NO token
        if (user.taqeem.password !== password) {
            return res.status(401).json({ message: "Invalid credentials" });
        }

        // CASE 3 — user exists and bootstrap already used → NO token
        if (user.taqeem.bootstrap_used) {
            return res.status(403).json({
                status: "LOGIN_REQUIRED"
            });
        }

        // CASE 4 — user exists, password correct, bootstrap not yet used → send token
        const payload = {
            id: user._id.toString(),
            phone: user.phone || null,
            type: user.type || "taqeem",
            role: user.role || "user",
            company: user.company || null,
            permissions: user.permissions || []
        };

        const accessToken = generateAccessToken(payload);
        const refreshToken = generateRefreshToken(payload);

        res.cookie("refreshToken", refreshToken, {
            httpOnly: true,
            secure: process.env.NODE_ENV === "production",
            sameSite: "Strict",
            maxAge: 7 * 24 * 60 * 60 * 1000
        });

        return res.json({
            status: "BOOTSTRAP_GRANTED",
            token: accessToken,
            refreshToken,
            userId: user._id
        });

    } catch (err) {
        console.error(err);
        return res.status(500).json({ message: "Server error", error: err.message });
    }
};

exports.authorizeTaqeem = async (req, res) => {
    try {
        const userId = req.userId;
        console.log("userId", userId);


        const user = await User.findById(userId);

        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        // 1) If user has normal credentials → authorize directly
        if (user.phone && user.password) {
            return res.json({
                status: 'AUTHORIZED',
                reason: 'NORMAL_ACCOUNT',
                userId: user._id
            });
        }

        // 2) Ensure taqeem profile exists
        if (!user.taqeem) {
            return res.status(400).json({
                status: 'NOT_AUTHORIZED',
                message: 'Taqeem account not configured'
            });
        }

        // 3) Bootstrap flow
        // If already used → deny authorization
        if (user.taqeem.bootstrap_used) {
            return res.status(403).json({
                status: 'LOGIN_REQUIRED'
            });
        }

        // Not used yet → mark as used and authorize
        user.taqeem.bootstrap_used = true;
        await user.save();

        return res.json({
            status: 'AUTHORIZED',
            reason: 'BOOTSTRAP_ACTIVATED',
            userId: user._id
        });

    } catch (err) {
        console.error(err);
        return res.status(500).json({ message: 'Server error', error: err.message });
    }
};

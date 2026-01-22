const bcrypt = require('bcryptjs');
const User = require('../../infrastructure/models/user');
const Company = require('../../infrastructure/models/company');
const Subscription = require('../../infrastructure/models/subscription');
const Package = require('../../infrastructure/models/package');
const StoredFile = require('../../infrastructure/models/storedFile');
const SystemState = require('../../infrastructure/models/systemState');


const { generateAccessToken, generateRefreshToken } = require('../../application/services/user/jwt.service');
const { storeUploadedFile, buildFileUrl } = require('../../application/services/files/fileStorage.service');

const buildUserPayload = (user) => ({
    _id: user._id,
    phone: user.phone,
    type: user.type,
    role: user.role,
    company: user.company,
    companyName: user.companyName,
    headName: user.headName,
    taqeem: user.taqeem,
    permissions: user.permissions,
    profileImagePath: user.profileImagePath || '',
    profileImageFileId: user.profileImageFileId || null,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt
});

const DEFAULT_GUEST_LIMIT = 1;

const getBootstrapUses = (user) => {
    const uses = Number(user?.taqeem?.bootstrap_uses);
    if (Number.isFinite(uses)) return uses;
    return user?.taqeem?.bootstrap_used ? 1 : 0;
};

const setBootstrapUses = (user, uses) => {
    if (!user.taqeem) {
        user.taqeem = { username: '', password: '' };
    }
    const next = Math.max(0, Number(uses) || 0);
    user.taqeem.bootstrap_uses = next;
    user.taqeem.bootstrap_used = next > 0;
};

const getGuestAccessConfig = async () => {
    const state = await SystemState.getSingleton();
    const enabled = state?.guestAccessEnabled !== false;
    const limitRaw = Number(state?.guestAccessLimit);
    const maxUses = Number.isFinite(limitRaw) && limitRaw > 0 ? limitRaw : DEFAULT_GUEST_LIMIT;
    return { enabled, maxUses };
};

exports.register = async (req, res) => {
    try {
        const { phone, password, type, companyName, companyHead, taqeemUsername } = req.body;

        if (!phone || !password) {
            return res.status(400).json({ message: 'Phone and password are required.' });
        }

        if (type === 'company' && (!companyName || !companyHead)) {
            return res.status(400).json({ message: 'Company name and head are required for company accounts.' });
        }

        const trimmedPhone = String(phone).trim();
        const trimmedTaqeem = taqeemUsername && taqeemUsername.trim() !== ''
            ? taqeemUsername.trim()
            : '';

        const authUserId = req.userId;
        const authUser = authUserId ? await User.findById(authUserId) : null;

        const existingUserByPhone = await User.findOne({ phone: trimmedPhone });
        if (existingUserByPhone && (!authUser || existingUserByPhone._id.toString() !== authUser._id.toString())) {
            return res.status(409).json({ message: 'User with this phone number already exists.' });
        }

        let existingUserByTaqeem = null;
        if (trimmedTaqeem) {
            existingUserByTaqeem = await User.findOne({ 'taqeem.username': trimmedTaqeem });
        }

        if (authUser && authUser.phone) {
            return res.status(409).json({ message: 'User with this phone number already exists.' });
        }

        if (authUser && existingUserByTaqeem && existingUserByTaqeem._id.toString() !== authUser._id.toString()) {
            return res.status(409).json({
                message: 'User with this Taqeem account already exists.'
            });
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        let companyDoc = null;
        let user;
        let linkedExisting = false;

        const applyRegistration = async (target) => {
            target.phone = trimmedPhone;
            target.password = hashedPassword;
            target.type = type;

            if (type === 'company') {
                target.role = 'company-head';
                target.headName = companyHead;
                target.companyName = companyName;

                companyDoc = new Company({
                    name: companyName,
                    headName: companyHead,
                    phone: trimmedPhone,
                    headUser: target._id
                });
                await companyDoc.save();

                target.company = companyDoc._id;
            } else {
                target.role = 'individual';
                target.company = null;
                target.companyName = undefined;
                target.headName = undefined;
            }

            if (trimmedTaqeem) {
                target.taqeem = target.taqeem || {};
                target.taqeem.username = trimmedTaqeem;
            }

            await target.save();
            return target;
        };

        if (authUser && !authUser.phone) {
            user = await applyRegistration(authUser);
            linkedExisting = true;
        } else if (existingUserByTaqeem) {
            user = existingUserByTaqeem;
            if (user.phone) {
                return res.status(409).json({
                    message: 'User with this Taqeem account already exists.'
                });
            }
            user = await applyRegistration(user);
            linkedExisting = true;
        } else {
            if (type === 'company') {
                user = new User({
                    phone: trimmedPhone,
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
                    phone: trimmedPhone,
                    headUser: user._id
                });
                await companyDoc.save();

                user.company = companyDoc._id;
                await user.save();
            } else {
                user = new User({
                    phone: trimmedPhone,
                    password: hashedPassword,
                    type: 'individual',
                    role: 'individual'
                });
                await user.save();
            }

            if (trimmedTaqeem) {
                user.taqeem = user.taqeem || {};
                user.taqeem.username = trimmedTaqeem;
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
            message: linkedExisting ? 'User account linked and updated successfully.' : 'User registered successfully.',
            token: accessToken,
            refreshToken,
            user: buildUserPayload(user)
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
            user: buildUserPayload(user)
        });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ message: 'Server error', error: err.message });
    }
};

exports.guestBootstrap = async (req, res) => {
    try {
        let user = null;
        if (req.userId) {
            user = await User.findById(req.userId);
        }

        if (!user) {
            user = await User.create({});
        }

        const isGuest = !user.phone;
        const payload = {
            id: user._id.toString(),
            phone: user.phone || null,
            type: user.type || 'individual',
            role: user.role || 'user',
            company: user.company || null,
            permissions: user.permissions || [],
            guest: isGuest
        };

        const accessToken = generateAccessToken(payload);
        const refreshToken = generateRefreshToken(payload);

        res.cookie('refreshToken', refreshToken, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'Strict',
            maxAge: 7 * 24 * 60 * 60 * 1000
        });

        return res.json({
            status: req.userId ? 'GUEST_REFRESHED' : 'GUEST_CREATED',
            token: accessToken,
            refreshToken,
            userId: user._id
        });
    } catch (err) {
        return res.status(500).json({ message: 'Server error', error: err.message });
    }
};

exports.uploadProfileImage = async (req, res) => {
    try {
        const userId = req.userId;
        if (!userId) {
            return res.status(401).json({ message: 'Authentication required' });
        }
        if (!req.file) {
            return res.status(400).json({ message: 'Profile image is required' });
        }

        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        const storedFile = await storeUploadedFile(req.file, { ownerId: user._id, purpose: 'profile' });
        if (user.profileImageFileId) {
            await StoredFile.findByIdAndDelete(user.profileImageFileId).catch(() => null);
        }

        user.profileImageFileId = storedFile._id;
        user.profileImagePath = buildFileUrl(storedFile._id.toString());
        await user.save();

        return res.json({ user: buildUserPayload(user) });
    } catch (err) {
        return res.status(500).json({ message: 'Failed to upload profile image', error: err.message });
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
                    bootstrap_uses: 0,
                }
            });

            const payload = {
                id: user._id.toString(),
                phone: null,
                type: user.type || "taqeem",
                role: user.role || "user",
                company: user.company || null,
                permissions: user.permissions || [],
                guest: true
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

        // CASE 3 — user exists and bootstrap limit reached → NO token
        const { enabled, maxUses } = await getGuestAccessConfig();
        const uses = getBootstrapUses(user);
        if (enabled && uses >= maxUses) {
            return res.status(403).json({
                status: "LOGIN_REQUIRED",
                reason: "BOOTSTRAP_LIMIT_REACHED"
            });
        }

        // CASE 4 — user exists, password correct, bootstrap not yet used → send token
        const payload = {
            id: user._id.toString(),
            phone: null,
            type: user.type || "taqeem",
            role: user.role || "user",
            company: user.company || null,
            permissions: user.permissions || [],
            guest: true
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
}

exports.newTaqeemBootstrap = async (req, res) => {
    try {
        const { username } = req.body;

        if (req.userId) {
            return res.json({
                status: "NORMAL_ACCOUNT",
                userId: req.userId
            });
        }

        if (!username?.trim()) {
            return res.status(400).json({ status: 'ERROR', message: 'Username required' });
        }

        const trimmedUsername = username.trim();
        let user = await User.findOne({ "taqeem.username": trimmedUsername });

        // Create new user if not found
        if (!user) {
            user = await User.create({
                taqeem: { username: trimmedUsername, password: '', bootstrap_used: false, bootstrap_uses: 0 }
            });

            const pkg = await Package.findById("692efc0d41a4767cfb91821b");
            if (!pkg) throw new Error("Package not found");

            console.log("pkg", pkg);

            const points = pkg.points;

            const subscriptions = new Subscription({
                userId: user._id,
                packageId: "692efc0d41a4767cfb91821b",
                remainingPoints: points
            });

            await subscriptions.save();

            // Generate token for the new user
            const payload = {
                id: user._id.toString(),
                phone: null,
                type: user.type || "taqeem",
                role: user.role || "user",
                company: user.company || null,
                permissions: user.permissions || [],
                guest: true
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
                reason: 'NEW_USER'
            });
        }

        // Check if bootstrap limit reached
        const { enabled, maxUses } = await getGuestAccessConfig();
        const uses = getBootstrapUses(user);
        if (enabled && uses >= maxUses) {
            return res.status(403).json({
                status: "LOGIN_REQUIRED",
                reason: 'BOOTSTRAP_LIMIT_REACHED'
            });
        }

        // User exists and bootstrap is available - generate token
        const payload = {
            id: user._id.toString(),
            phone: null,
            type: user.type || "taqeem",
            role: user.role || "user",
            company: user.company || null,
            permissions: user.permissions || [],
            guest: true
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
            reason: 'BOOTSTRAP_AVAILABLE'
        });

    } catch (err) {
        console.error(err);
        return res.status(500).json({
            status: 'ERROR',
            message: 'Server error',
            error: err.message
        });
    }
};


exports.authorizeTaqeem = async (req, res) => {
    try {
        const userId = req.userId;
        const assetCount = Number(req.body.assetCount || 0);

        const user = await User.findById(userId);

        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        /**
         * 1) NORMAL USER FLOW (phone + password)
         *    Only here we validate asset count
         */
        if (user.phone && user.password) {

            if (assetCount > 0) {
                const subscriptions = await Subscription.find({ userId });

                const remainingPoints = subscriptions.reduce(
                    (sum, sub) => sum + (sub.remainingPoints || 0),
                    0
                );

                if (assetCount > remainingPoints) {
                    return res.status(200).json({
                        status: 'INSUFFICIENT_POINTS',
                        required: assetCount,
                        available: remainingPoints
                    });
                }
            }

            return res.json({
                status: 'AUTHORIZED',
                reason: 'NORMAL_ACCOUNT',
                userId: user._id
            });
        }

        /**
         * 2) NON-NORMAL USER FLOW → BOOTSTRAP ONLY
         */

        // ensure taqeem profile exists
        if (!user.taqeem) {
            return res.status(400).json({
                status: 'NOT_AUTHORIZED',
                message: 'Taqeem account not configured'
            });
        }

        // if bootstrap limit reached, force login
        const { enabled, maxUses } = await getGuestAccessConfig();
        const uses = getBootstrapUses(user);
        if (enabled && uses >= maxUses) {
            return res.status(403).json({
                status: 'LOGIN_REQUIRED',
                reason: 'BOOTSTRAP_LIMIT_REACHED'
            });
        }

        if (enabled) {
            setBootstrapUses(user, uses + 1);
            await user.save();
        }

        return res.json({
            status: 'AUTHORIZED',
            reason: enabled ? 'BOOTSTRAP_ACTIVATED' : 'BOOTSTRAP_UNLIMITED',
            userId: user._id
        });

    } catch (err) {
        console.error(err);
        return res.status(500).json({
            message: 'Server error',
            error: err.message
        });
    }
};


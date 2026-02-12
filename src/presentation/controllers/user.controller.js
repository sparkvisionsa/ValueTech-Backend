const bcrypt = require("bcryptjs");
const mongoose = require("mongoose");
const User = require("../../infrastructure/models/user");
const Company = require("../../infrastructure/models/company");
const Subscription = require("../../infrastructure/models/subscription");
const Package = require("../../infrastructure/models/package");
const StoredFile = require("../../infrastructure/models/storedFile");
const SystemState = require("../../infrastructure/models/systemState");
const SubmitReportsQuickly = require("../../infrastructure/models/SubmitReportsQuickly");
const DuplicateReport = require("../../infrastructure/models/DuplicateReport");
const Report = require("../../infrastructure/models/report");
const UrgentReport = require("../../infrastructure/models/UrgentReport");
const ElrajhiReport = require("../../infrastructure/models/ElrajhiReport");
const MultiApproachReport = require("../../infrastructure/models/MultiApproachReport");
const PointDeduction = require("../../infrastructure/models/pointDeduction");
const PaymentRequest = require("../../infrastructure/models/paymentRequest");
const Notification = require("../../infrastructure/models/notification");
const UserUpdateStatus = require("../../infrastructure/models/userUpdateStatus");

const {
  generateAccessToken,
  generateRefreshToken,
} = require("../../application/services/user/jwt.service");
const {
  storeUploadedFile,
  buildFileUrl,
} = require("../../application/services/files/fileStorage.service");
const { normalizeOfficeId } = require("../utils/companyOffice");
const {
  normalizeTaqeemUsername,
  normalizeProfile,
  extractTaqeemUsernameFromProfile,
  normalizeCompanies,
  mergeCompanies,
  mergePhones,
  resolveDefaultCompanyOfficeId,
  safeString,
} = require("../utils/taqeemUser");

const buildUserPayload = (user) => ({
  _id: user._id,
  phone: user.phone,
  phones: Array.isArray(user.phones) ? user.phones : [],
  type: user.type,
  role: user.role,
  company: user.company,
  companyName: user.companyName,
  headName: user.headName,
  taqeem: user.taqeem,
  taqeemUser: user?.taqeem?.username || null,
  defaultCompanyOfficeId: user?.taqeem?.defaultCompanyOfficeId || null,
  permissions: user.permissions,
  profileImagePath: user.profileImagePath || "",
  profileImageFileId: user.profileImageFileId || null,
  createdAt: user.createdAt,
  updatedAt: user.updatedAt,
});

const DEFAULT_GUEST_LIMIT = 1;
const DEFAULT_GUEST_FREE_POINTS = 400;
const BOOTSTRAP_PACKAGE_ID =
  process.env.BOOTSTRAP_PACKAGE_ID || "692efc0d41a4767cfb91821b";

let phoneIndexEnsured = false;

const ensureUserPhoneSparseIndex = async () => {
  if (phoneIndexEnsured) return;
  try {
    const indexes = await User.collection.indexes();
    const phoneIndex = indexes.find((idx) => idx.name === "phone_1");
    const isSparseOrPartial =
      Boolean(phoneIndex?.sparse) ||
      Boolean(phoneIndex?.partialFilterExpression);

    if (phoneIndex && !isSparseOrPartial) {
      try {
        await User.collection.dropIndex("phone_1");
      } catch (dropErr) {
        console.warn(
          "[user.controller] Failed to drop phone index:",
          dropErr?.message || dropErr,
        );
      }
    }

    if (!phoneIndex || !isSparseOrPartial) {
      try {
        await User.updateMany({ phone: null }, { $unset: { phone: "" } });
      } catch (unsetErr) {
        console.warn(
          "[user.controller] Failed to unset null phones:",
          unsetErr?.message || unsetErr,
        );
      }
      try {
        await User.collection.createIndex(
          { phone: 1 },
          { unique: true, sparse: true },
        );
      } catch (createErr) {
        console.warn(
          "[user.controller] Failed to create sparse phone index:",
          createErr?.message || createErr,
        );
      }
    }

    phoneIndexEnsured = true;
  } catch (err) {
    console.warn(
      "[user.controller] Failed to ensure phone index:",
      err?.message || err,
    );
  }
};

const ensureTaqeemState = (user) => {
  if (!user.taqeem || typeof user.taqeem !== "object") {
    user.taqeem = {
      username: "",
      password: "",
      bootstrap_used: false,
      bootstrap_uses: 0,
      companies: [],
    };
  }

  if (!Array.isArray(user.taqeem.companies)) {
    user.taqeem.companies = [];
  }

  if (!Array.isArray(user.phones)) {
    user.phones = [];
  }
};

const normalizedPhone = (value) => {
  const trimmed = safeString(value);
  return trimmed || null;
};

const buildUserIdFilter = (userId) => {
  const userIdStr = String(userId || "").trim();
  if (!userIdStr) return null;

  const clauses = [{ user_id: userIdStr }];
  if (mongoose.Types.ObjectId.isValid(userIdStr)) {
    clauses.push({ user_id: new mongoose.Types.ObjectId(userIdStr) });
  }
  return { $or: clauses };
};

const buildMissingPhoneFilter = () => ({
  $or: [
    { user_phone: { $exists: false } },
    { user_phone: null },
    { user_phone: "" },
  ],
});

const syncGuestReportPhones = async (userId, phone) => {
  const userFilter = buildUserIdFilter(userId);
  const phoneValue = String(phone || "").trim();
  if (!userFilter || !phoneValue) return;

  const query = { $and: [userFilter, buildMissingPhoneFilter()] };
  const update = { $set: { user_phone: phoneValue } };

  await Promise.all([
    SubmitReportsQuickly.updateMany(query, update),
    DuplicateReport.updateMany(query, update),
    Report.updateMany(query, update),
    UrgentReport.updateMany(query, update),
    ElrajhiReport.updateMany(query, update),
  ]);
};

const isGuestOnlyUser = (user) => !normalizedPhone(user?.phone);

const buildReportOwnershipFilter = (userId) => {
  const userIdStr = String(userId || "").trim();
  if (!userIdStr) return null;

  const clauses = [{ user_id: userIdStr }, { userId: userIdStr }];
  if (mongoose.Types.ObjectId.isValid(userIdStr)) {
    const objectId = new mongoose.Types.ObjectId(userIdStr);
    clauses.push({ user_id: objectId }, { userId: objectId });
  }

  return { $or: clauses };
};

const moveReportOwnership = async (fromUserId, toUserId, taqeemUser = null) => {
  const fromFilter = buildReportOwnershipFilter(fromUserId);
  const toUserIdStr = String(toUserId || "").trim();
  if (!fromFilter || !toUserIdStr) return;

  const reportModels = [
    SubmitReportsQuickly,
    DuplicateReport,
    Report,
    UrgentReport,
    ElrajhiReport,
    MultiApproachReport,
  ];

  const setPayload = { user_id: toUserIdStr };
  if (safeString(taqeemUser)) {
    setPayload.taqeem_user = safeString(taqeemUser);
  }

  await Promise.all(
    reportModels.map((Model) =>
      Model.updateMany(fromFilter, { $set: setPayload }),
    ),
  );
};

const hasUserReferences = async (userId) => {
  const ownershipFilter = buildReportOwnershipFilter(userId);
  if (!ownershipFilter) return true;

  const referenceCounts = await Promise.all([
    SubmitReportsQuickly.countDocuments(ownershipFilter),
    DuplicateReport.countDocuments(ownershipFilter),
    Report.countDocuments(ownershipFilter),
    UrgentReport.countDocuments(ownershipFilter),
    ElrajhiReport.countDocuments(ownershipFilter),
    MultiApproachReport.countDocuments(ownershipFilter),
    Subscription.countDocuments({ userId }),
    PointDeduction.countDocuments({ userId }),
    PaymentRequest.countDocuments({ userId }),
    Notification.countDocuments({ userId }),
    UserUpdateStatus.countDocuments({ userId }),
    Company.countDocuments({ headUser: userId }),
    StoredFile.countDocuments({ ownerId: userId }),
  ]);

  return referenceCounts.some((count) => Number(count) > 0);
};

const mergeGuestTaqeemUsers = async ({
  primaryUser,
  secondaryUser,
  username,
  password = "",
}) => {
  if (!primaryUser || !secondaryUser) return primaryUser;
  if (String(primaryUser._id) === String(secondaryUser._id)) return primaryUser;

  ensureTaqeemState(primaryUser);
  ensureTaqeemState(secondaryUser);

  const normalizedUsername = normalizeTaqeemUsername(
    username ||
      primaryUser?.taqeem?.username ||
      secondaryUser?.taqeem?.username,
  );
  if (normalizedUsername) {
    primaryUser.taqeem.username = normalizedUsername;
  }

  const primaryPassword = safeString(primaryUser?.taqeem?.password);
  const incomingPassword = safeString(password);
  const secondaryPassword = safeString(secondaryUser?.taqeem?.password);
  if (!primaryPassword) {
    if (incomingPassword) {
      primaryUser.taqeem.password = incomingPassword;
    } else if (secondaryPassword) {
      primaryUser.taqeem.password = secondaryPassword;
    }
  }

  if (!primaryUser?.taqeem?.profile && secondaryUser?.taqeem?.profile) {
    primaryUser.taqeem.profile = secondaryUser.taqeem.profile;
  }

  primaryUser.taqeem.companies = mergeCompanies(
    primaryUser.taqeem.companies || [],
    secondaryUser.taqeem.companies || [],
  );

  const primaryDefaultOfficeId = normalizeOfficeId(
    primaryUser?.taqeem?.defaultCompanyOfficeId || null,
  );
  const secondaryDefaultOfficeId = normalizeOfficeId(
    secondaryUser?.taqeem?.defaultCompanyOfficeId || null,
  );
  const resolvedDefaultOfficeId = resolveDefaultCompanyOfficeId(
    primaryDefaultOfficeId || secondaryDefaultOfficeId,
    primaryUser.taqeem.companies,
  );
  if (resolvedDefaultOfficeId) {
    primaryUser.taqeem.defaultCompanyOfficeId = resolvedDefaultOfficeId;
  }

  const firstSelectedDates = [
    primaryUser?.taqeem?.firstCompanySelectedAt,
    secondaryUser?.taqeem?.firstCompanySelectedAt,
  ]
    .filter(Boolean)
    .map((value) => new Date(value))
    .filter((value) => !Number.isNaN(value.getTime()))
    .sort((a, b) => a.getTime() - b.getTime());
  if (firstSelectedDates.length > 0) {
    primaryUser.taqeem.firstCompanySelectedAt = firstSelectedDates[0];
  }

  const lastSyncedDates = [
    primaryUser?.taqeem?.lastSyncedAt,
    secondaryUser?.taqeem?.lastSyncedAt,
  ]
    .filter(Boolean)
    .map((value) => new Date(value))
    .filter((value) => !Number.isNaN(value.getTime()))
    .sort((a, b) => b.getTime() - a.getTime());
  if (lastSyncedDates.length > 0) {
    primaryUser.taqeem.lastSyncedAt = lastSyncedDates[0];
  }

  if (primaryUser.phone) {
    primaryUser.phones = mergePhones(primaryUser.phones, primaryUser.phone);
  }
  if (secondaryUser.phone) {
    primaryUser.phones = mergePhones(primaryUser.phones, secondaryUser.phone);
  }

  setBootstrapUses(
    primaryUser,
    Math.max(getBootstrapUses(primaryUser), getBootstrapUses(secondaryUser)),
  );

  await primaryUser.save();
  await moveReportOwnership(
    secondaryUser._id,
    primaryUser._id,
    primaryUser?.taqeem?.username || null,
  );
  await Promise.all([
    Subscription.updateMany(
      { userId: secondaryUser._id },
      { $set: { userId: primaryUser._id } },
    ),
    PointDeduction.updateMany(
      { userId: secondaryUser._id },
      { $set: { userId: primaryUser._id } },
    ),
    PaymentRequest.updateMany(
      { userId: secondaryUser._id },
      { $set: { userId: primaryUser._id } },
    ),
    Notification.updateMany(
      { userId: secondaryUser._id },
      { $set: { userId: primaryUser._id } },
    ),
    UserUpdateStatus.updateMany(
      { userId: secondaryUser._id },
      { $set: { userId: primaryUser._id } },
    ),
  ]);

  ensureTaqeemState(secondaryUser);
  secondaryUser.taqeem.username = null;
  secondaryUser.taqeem.password = "";
  secondaryUser.taqeem.profile = null;
  secondaryUser.taqeem.companies = [];
  secondaryUser.taqeem.defaultCompanyOfficeId = null;
  secondaryUser.taqeem.firstCompanySelectedAt = null;
  secondaryUser.taqeem.lastSyncedAt = null;
  setBootstrapUses(secondaryUser, 0);
  secondaryUser.markModified("taqeem");

  const shouldDeleteSecondary =
    isGuestOnlyUser(secondaryUser) &&
    !safeString(secondaryUser?.taqeem?.username) &&
    !secondaryUser?.company;

  if (shouldDeleteSecondary) {
    const hasReferences = await hasUserReferences(secondaryUser._id);
    if (!hasReferences) {
      await User.deleteOne({ _id: secondaryUser._id });
      return primaryUser;
    }
  }

  await secondaryUser.save();

  return primaryUser;
};

const getBootstrapUses = (user) => {
  const uses = Number(user?.taqeem?.bootstrap_uses);
  if (Number.isFinite(uses)) return uses;
  return user?.taqeem?.bootstrap_used ? 1 : 0;
};

const setBootstrapUses = (user, uses) => {
  ensureTaqeemState(user);
  const next = Math.max(0, Number(uses) || 0);
  user.taqeem.bootstrap_uses = next;
  user.taqeem.bootstrap_used = next > 0;
};

const getGuestAccessConfig = async () => {
  const state = await SystemState.getSingleton();
  const enabled = state?.guestAccessEnabled !== false;
  const limitRaw = Number(state?.guestAccessLimit);
  const maxUses =
    Number.isFinite(limitRaw) && limitRaw > 0 ? limitRaw : DEFAULT_GUEST_LIMIT;
  return { enabled, maxUses };
};

const resolveGuestFreePoints = async (pkg) => {
  const systemState = await SystemState.getSingleton();
  const configuredPoints = Number(systemState?.guestFreePoints);
  if (Number.isFinite(configuredPoints) && configuredPoints > 0) {
    return configuredPoints;
  }

  const pkgPoints = Number(pkg?.points);
  if (Number.isFinite(pkgPoints) && pkgPoints > 0) {
    return pkgPoints;
  }

  return DEFAULT_GUEST_FREE_POINTS;
};

const ensureFreeSubscription = async (user, options = {}) => {
  if (!user?._id) return null;
  const { allowPhone = false } = options;
  if (!allowPhone && user.phone) return null;

  const existing = await Subscription.findOne({ userId: user._id });
  if (existing) return existing;

  const pkg = await Package.findById(BOOTSTRAP_PACKAGE_ID);
  if (!pkg) {
    throw new Error("Package not found");
  }

  const freePoints = await resolveGuestFreePoints(pkg);
  return Subscription.create({
    userId: user._id,
    packageId: pkg._id,
    remainingPoints: freePoints,
  });
};

const buildTokenPayload = (user) => ({
  id: user._id.toString(),
  phone: user.phone || null,
  type: user.type || "taqeem",
  role: user.role || "user",
  company: user.company || null,
  permissions: user.permissions || [],
  guest: !user.phone,
  taqeemUser: user?.taqeem?.username || null,
  defaultCompanyOfficeId: user?.taqeem?.defaultCompanyOfficeId || null,
});

const issueAuthTokens = (res, user, meta = {}) => {
  const payload = buildTokenPayload(user);
  const accessToken = generateAccessToken(payload);
  const refreshToken = generateRefreshToken(payload);

  res.cookie("refreshToken", refreshToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "Strict",
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });

  return res.json({
    ...meta,
    token: accessToken,
    refreshToken,
    userId: user._id,
    user: buildUserPayload(user),
    guest: !user.phone,
  });
};

const findUserByPhone = async (phone) => {
  const cleaned = normalizedPhone(phone);
  if (!cleaned) return null;
  return User.findOne({ $or: [{ phone: cleaned }, { phones: cleaned }] });
};

const taqeemAlreadyUsedPayload = (existingUser) => ({
  status: "TAQEEM_ALREADY_USED",
  reason: "SYSTEM_LOGIN_REQUIRED",
  message:
    "This Taqeem user is already linked to another Value Tech account. Please login to Value Tech.",
  existingUserId: existingUser?._id || null,
  guest: !existingUser?.phone,
});

const linkTaqeemUsernameToUser = async (user, username, password = "") => {
  const trimmedUsername = normalizeTaqeemUsername(username);
  if (!trimmedUsername) return user;

  ensureTaqeemState(user);
  user.taqeem.username = trimmedUsername;

  const trimmedPassword = safeString(password);
  if (trimmedPassword && !safeString(user?.taqeem?.password)) {
    user.taqeem.password = trimmedPassword;
  }

  await user.save();
  return user;
};

const resolveUserCompany = async ({
  targetUser,
  type,
  companyName,
  companyHead,
  phone,
}) => {
  if (!targetUser) return;

  if (type === "company") {
    targetUser.type = "company";
    targetUser.role = "company-head";
    targetUser.headName = companyHead;
    targetUser.companyName = companyName;

    let companyDoc = null;
    if (targetUser.company) {
      companyDoc = await Company.findById(targetUser.company);
    }

    if (!companyDoc) {
      companyDoc = new Company({
        name: companyName,
        headName: companyHead,
        phone,
        headUser: targetUser._id,
      });
    } else {
      companyDoc.name = companyName;
      companyDoc.headName = companyHead;
      companyDoc.phone = phone;
      if (!companyDoc.headUser) {
        companyDoc.headUser = targetUser._id;
      }
    }

    await companyDoc.save();
    targetUser.company = companyDoc._id;
  } else {
    targetUser.type = "individual";
    targetUser.role = "individual";
    targetUser.company = null;
    targetUser.companyName = undefined;
    targetUser.headName = undefined;
  }
};

exports.register = async (req, res) => {
  try {
    const { phone, password, type, companyName, companyHead, taqeemUsername } =
      req.body || {};

    const incomingType = type === "company" ? "company" : "individual";
    const trimmedPhone = normalizedPhone(phone);
    const trimmedTaqeem = normalizeTaqeemUsername(taqeemUsername);

    let authUser = null;
    if (req.userId) {
      authUser = await User.findById(req.userId);
    }

    if (!trimmedPhone || !password) {
      return res
        .status(400)
        .json({ message: "Phone and password are required." });
    }

    if (incomingType === "company" && (!companyName || !companyHead)) {
      return res.status(400).json({
        message: "Company name and head are required for company accounts.",
      });
    }

    const existingUserByPhone = await findUserByPhone(trimmedPhone);
    const existingUserByTaqeem = trimmedTaqeem
      ? await User.findOne({ "taqeem.username": trimmedTaqeem })
      : null;

    const isSame = (a, b) => Boolean(a && b && String(a._id) === String(b._id));

    if (
      existingUserByPhone &&
      !isSame(existingUserByPhone, authUser) &&
      !isSame(existingUserByPhone, existingUserByTaqeem)
    ) {
      return res
        .status(409)
        .json({ message: "User with this phone number already exists." });
    }

    if (
      existingUserByPhone &&
      existingUserByTaqeem &&
      !isSame(existingUserByPhone, existingUserByTaqeem)
    ) {
      return res.status(409).json({
        message:
          "Phone and Taqeem username belong to different accounts. Please login with the linked account first.",
      });
    }

    let user =
      existingUserByTaqeem ||
      (authUser && !authUser.phone ? authUser : null) ||
      existingUserByPhone ||
      null;

    const linkedExisting = Boolean(user);

    if (!user) {
      user = new User({});
    }

    const conflictByPhone = await User.findOne({
      _id: { $ne: user._id },
      $or: [{ phone: trimmedPhone }, { phones: trimmedPhone }],
    });

    if (conflictByPhone) {
      return res
        .status(409)
        .json({ message: "User with this phone number already exists." });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    if (!user.phone) {
      user.phone = trimmedPhone;
    }

    ensureTaqeemState(user);
    user.phones = mergePhones(user.phones, trimmedPhone);
    user.password = hashedPassword;

    await resolveUserCompany({
      targetUser: user,
      type: incomingType,
      companyName,
      companyHead,
      phone: user.phone || trimmedPhone,
    });

    if (trimmedTaqeem) {
      user.taqeem.username = trimmedTaqeem;
    }

    await user.save();

    if (user?.phone && (linkedExisting || authUser?._id || req.userId)) {
      try {
        const syncUserId = authUser?._id || req.userId || user._id;
        await syncGuestReportPhones(syncUserId, user.phone);
      } catch (syncErr) {
        console.warn(
          "[register] Failed to sync guest report phones:",
          syncErr?.message || syncErr,
        );
      }
    }

    await ensureFreeSubscription(user, { allowPhone: true });

    const payload = buildTokenPayload(user);
    const accessToken = generateAccessToken(payload);
    const refreshToken = generateRefreshToken(payload);

    res.cookie("refreshToken", refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "Strict",
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    res.status(201).json({
      message: linkedExisting
        ? "User account linked and updated successfully."
        : "User registered successfully.",
      token: accessToken,
      refreshToken,
      user: buildUserPayload(user),
    });
  } catch (err) {
    res.status(500).json({ message: "Server error", error: err.message });
  }
};

exports.login = async (req, res) => {
  try {
    const { phone, password } = req.body || {};
    const guestUserId = safeString(req.body?.guestUserId || req.userId);
    const guestTaqeemUser = normalizeTaqeemUsername(req.body?.guestTaqeemUser);
    const trimmedPhone = normalizedPhone(phone);

    if (!trimmedPhone || !password) {
      return res
        .status(400)
        .json({ message: "Phone and password are required." });
    }

    const user = await findUserByPhone(trimmedPhone);
    if (!user) {
      return res.status(404).json({ message: "User not found." });
    }

    if (!user.password) {
      return res.status(401).json({ message: "Invalid credentials." });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ message: "Invalid credentials." });
    }

    const resolvedTaqeemUser =
      normalizeTaqeemUsername(user?.taqeem?.username) ||
      guestTaqeemUser ||
      null;

    if (guestUserId && String(guestUserId) !== String(user._id)) {
      try {
        await moveReportOwnership(guestUserId, user._id, resolvedTaqeemUser);
      } catch (ownershipErr) {
        console.warn(
          "[login] Failed to move guest report ownership:",
          ownershipErr?.message || ownershipErr,
        );
      }
    }

    try {
      await syncGuestReportPhones(user._id, user.phone);
    } catch (syncErr) {
      console.warn(
        "[login] Failed to sync user phone on reports:",
        syncErr?.message || syncErr,
      );
    }

    const payload = buildTokenPayload(user);
    const accessToken = generateAccessToken(payload);
    const refreshToken = generateRefreshToken(payload);

    res.cookie("refreshToken", refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "Strict",
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    return res.status(200).json({
      message: "Login successful.",
      token: accessToken,
      refreshToken,
      user: buildUserPayload(user),
    });
  } catch (err) {
    console.error(err);
    return res
      .status(500)
      .json({ message: "Server error", error: err.message });
  }
};

exports.guestBootstrap = async (req, res) => {
  try {
    let user = null;
    if (req.userId) {
      user = await User.findById(req.userId);
    }

    if (!user) {
      await ensureUserPhoneSparseIndex();
      try {
        user = await User.create({});
      } catch (createErr) {
        const isDuplicatePhone =
          createErr?.code === 11000 &&
          (createErr?.keyPattern?.phone ||
            String(createErr?.message || "").includes("phone_1"));
        if (!isDuplicatePhone) {
          throw createErr;
        }

        await ensureUserPhoneSparseIndex();
        user = await User.create({});
      }
    }

    await ensureFreeSubscription(user);
    return issueAuthTokens(res, user, {
      status: req.userId ? "GUEST_REFRESHED" : "GUEST_CREATED",
    });
  } catch (err) {
    return res
      .status(500)
      .json({ message: "Server error", error: err.message });
  }
};

exports.uploadProfileImage = async (req, res) => {
  try {
    const userId = req.userId;
    if (!userId) {
      return res.status(401).json({ message: "Authentication required" });
    }
    if (!req.file) {
      return res.status(400).json({ message: "Profile image is required" });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const storedFile = await storeUploadedFile(req.file, {
      ownerId: user._id,
      purpose: "profile",
    });
    if (user.profileImageFileId) {
      await StoredFile.findByIdAndDelete(user.profileImageFileId).catch(
        () => null,
      );
    }

    user.profileImageFileId = storedFile._id;
    user.profileImagePath = buildFileUrl(storedFile._id.toString());
    await user.save();

    return res.json({ user: buildUserPayload(user) });
  } catch (err) {
    return res
      .status(500)
      .json({ message: "Failed to upload profile image", error: err.message });
  }
};

const handleTaqeemBootstrap = async (req, res) => {
  const { username, password } = req.body || {};
  const trimmedUsername = normalizeTaqeemUsername(username);

  if (!trimmedUsername) {
    return res.status(400).json({
      status: "ERROR",
      message: "Username required",
    });
  }

  let authUser = req.userId ? await User.findById(req.userId) : null;
  let user = await User.findOne({ "taqeem.username": trimmedUsername });

  if (authUser) {
    if (user && String(user._id) !== String(authUser._id)) {
      const canMergeGuestUsers =
        isGuestOnlyUser(authUser) && isGuestOnlyUser(user);

      if (!canMergeGuestUsers) {
        return res.status(409).json(taqeemAlreadyUsedPayload(user));
      }

      // Keep the already-linked Taqeem owner as the canonical user id.
      await mergeGuestTaqeemUsers({
        primaryUser: user,
        secondaryUser: authUser,
        username: trimmedUsername,
        password,
      });
      authUser = await User.findById(user._id);
    }

    await linkTaqeemUsernameToUser(authUser, trimmedUsername, password);
    await ensureFreeSubscription(authUser, { allowPhone: true });

    return issueAuthTokens(res, authUser, {
      status: "NORMAL_ACCOUNT",
      reason: "TAQEEM_LINKED_TO_CURRENT_SESSION",
    });
  }

  if (!user) {
    user = await User.create({
      taqeem: {
        username: trimmedUsername,
        password: safeString(password),
        bootstrap_used: false,
        bootstrap_uses: 0,
      },
    });

    await ensureFreeSubscription(user);

    return issueAuthTokens(res, user, {
      status: "BOOTSTRAP_GRANTED",
      reason: "NEW_TAQEEM_USER",
    });
  }

  if (user.phone) {
    return res.status(409).json(taqeemAlreadyUsedPayload(user));
  }

  const { enabled, maxUses } = await getGuestAccessConfig();
  const uses = getBootstrapUses(user);

  if (enabled && uses >= maxUses) {
    return res.status(403).json({
      status: "LOGIN_REQUIRED",
      reason: "GUEST_LIMIT_REACHED",
    });
  }

  if (safeString(password) && !safeString(user?.taqeem?.password)) {
    ensureTaqeemState(user);
    user.taqeem.password = safeString(password);
    await user.save();
  }

  await ensureFreeSubscription(user);

  return issueAuthTokens(res, user, {
    status: "LOGIN_SUCCESS",
    reason: "TAQEEM_USERNAME_LOGIN",
  });
};

exports.taqeemBootstrap = async (req, res) => {
  try {
    return await handleTaqeemBootstrap(req, res);
  } catch (err) {
    console.error(err);
    return res
      .status(500)
      .json({ message: "Server error", error: err.message });
  }
};

exports.newTaqeemBootstrap = async (req, res) => {
  try {
    return await handleTaqeemBootstrap(req, res);
  } catch (err) {
    console.error("[TAQEEM] error", err);

    return res.status(500).json({
      status: "ERROR",
      message: "Server error",
      error: err.message,
    });
  }
};

exports.syncTaqeemSnapshot = async (req, res) => {
  try {
    const userId = req.userId;
    if (!userId) {
      return res.status(401).json({
        status: "UNAUTHORIZED",
        message: "Authentication required",
      });
    }

    const currentUser = await User.findById(userId);
    if (!currentUser) {
      return res.status(404).json({
        status: "NOT_FOUND",
        message: "User not found",
      });
    }

    const profile = normalizeProfile(req.body?.profile || null);
    const requestedUsername = normalizeTaqeemUsername(
      req.body?.taqeemUser ||
        req.body?.username ||
        extractTaqeemUsernameFromProfile(profile) ||
        currentUser?.taqeem?.username,
    );

    if (!requestedUsername) {
      return res.status(400).json({
        status: "ERROR",
        message: "taqeemUser is required",
      });
    }

    const existingOwner = await User.findOne({
      "taqeem.username": requestedUsername,
    });
    let targetUser = currentUser;

    if (
      existingOwner &&
      String(existingOwner._id) !== String(currentUser._id)
    ) {
      const canMergeGuestUsers =
        isGuestOnlyUser(currentUser) && isGuestOnlyUser(existingOwner);

      if (!canMergeGuestUsers) {
        return res.status(409).json(taqeemAlreadyUsedPayload(existingOwner));
      }

      // Preserve the existing Taqeem owner id as canonical across sessions.
      targetUser = await mergeGuestTaqeemUsers({
        primaryUser: existingOwner,
        secondaryUser: currentUser,
        username: requestedUsername,
      });
    } else if (existingOwner) {
      targetUser = existingOwner;
    }

    ensureTaqeemState(targetUser);

    targetUser.taqeem.username = requestedUsername;
    if (profile) {
      targetUser.taqeem.profile = profile;
    }

    const incomingCompanies = normalizeCompanies(req.body?.companies || []);
    targetUser.taqeem.companies = mergeCompanies(
      targetUser.taqeem.companies || [],
      incomingCompanies,
    );

    const requestedOffice = normalizeOfficeId(
      req.body?.defaultCompanyOfficeId ||
        req.body?.selectedCompanyOfficeId ||
        req.body?.companyOfficeId ||
        null,
    );

    const resolvedDefaultOfficeId = resolveDefaultCompanyOfficeId(
      requestedOffice,
      targetUser.taqeem.companies,
    );

    if (resolvedDefaultOfficeId) {
      targetUser.taqeem.defaultCompanyOfficeId = resolvedDefaultOfficeId;
      if (!targetUser.taqeem.firstCompanySelectedAt) {
        targetUser.taqeem.firstCompanySelectedAt = new Date();
      }
    }

    targetUser.taqeem.lastSyncedAt = new Date();

    if (targetUser.phone) {
      targetUser.phones = mergePhones(targetUser.phones, targetUser.phone);
    }

    await targetUser.save();

    return res.json({
      status: "SYNCED",
      userId: targetUser._id,
      user: buildUserPayload(targetUser),
      taqeemUser: targetUser.taqeem.username,
      defaultCompanyOfficeId: targetUser.taqeem.defaultCompanyOfficeId || null,
      companies: targetUser.taqeem.companies || [],
      requiresCompanySelection: Boolean(
        (targetUser.taqeem.companies || []).length > 0 &&
        !targetUser.taqeem.defaultCompanyOfficeId,
      ),
    });
  } catch (err) {
    console.error("syncTaqeemSnapshot error", err);
    return res.status(500).json({
      status: "ERROR",
      message: "Server error",
      error: err.message,
    });
  }
};

exports.setDefaultTaqeemCompany = async (req, res) => {
  try {
    const userId = req.userId;
    if (!userId) {
      return res.status(401).json({
        status: "UNAUTHORIZED",
        message: "Authentication required",
      });
    }

    const officeId = normalizeOfficeId(
      req.body?.officeId ||
        req.body?.companyOfficeId ||
        req.body?.company_office_id ||
        null,
    );

    if (!officeId) {
      return res.status(400).json({
        status: "ERROR",
        message: "officeId is required",
      });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        status: "NOT_FOUND",
        message: "User not found",
      });
    }

    ensureTaqeemState(user);

    const resolvedOfficeId = resolveDefaultCompanyOfficeId(
      officeId,
      user.taqeem.companies,
    );

    if (!resolvedOfficeId) {
      return res.status(400).json({
        status: "ERROR",
        message: "Selected company is not part of this Taqeem account",
      });
    }

    user.taqeem.defaultCompanyOfficeId = resolvedOfficeId;
    if (!user.taqeem.firstCompanySelectedAt) {
      user.taqeem.firstCompanySelectedAt = new Date();
    }

    await user.save();

    return res.json({
      status: "DEFAULT_COMPANY_SET",
      officeId: resolvedOfficeId,
      user: buildUserPayload(user),
    });
  } catch (err) {
    console.error("setDefaultTaqeemCompany error", err);
    return res.status(500).json({
      status: "ERROR",
      message: "Server error",
      error: err.message,
    });
  }
};

exports.authorizeTaqeem = async (req, res) => {
  try {
    const userId = req.userId;
    const assetCount = Number(req.body.assetCount || 0);

    const user = await User.findById(userId);

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const checkPoints = async () => {
      if (assetCount <= 0) return null;
      const subscriptions = await Subscription.find({ userId });
      const remainingPoints = subscriptions.reduce(
        (sum, sub) => sum + (sub.remainingPoints || 0),
        0,
      );

      if (assetCount > remainingPoints) {
        return {
          status: "INSUFFICIENT_POINTS",
          required: assetCount,
          available: remainingPoints,
        };
      }

      return null;
    };

    if (user.phone && user.password) {
      const insufficient = await checkPoints();
      if (insufficient) {
        return res.status(200).json(insufficient);
      }

      return res.json({
        status: "AUTHORIZED",
        reason: "NORMAL_ACCOUNT",
        userId: user._id,
      });
    }

    if (!user.taqeem) {
      return res.status(400).json({
        status: "NOT_AUTHORIZED",
        message: "Taqeem account not configured",
      });
    }

    const { enabled, maxUses } = await getGuestAccessConfig();
    const uses = getBootstrapUses(user);
    if (enabled && uses >= maxUses) {
      return res.status(403).json({
        status: "LOGIN_REQUIRED",
        reason: "BOOTSTRAP_LIMIT_REACHED",
      });
    }

    const insufficient = await checkPoints();
    if (insufficient) {
      return res.status(200).json(insufficient);
    }

    if (enabled) {
      setBootstrapUses(user, uses + 1);
      await user.save();
    }

    return res.json({
      status: "AUTHORIZED",
      reason: enabled ? "BOOTSTRAP_ACTIVATED" : "BOOTSTRAP_UNLIMITED",
      userId: user._id,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({
      message: "Server error",
      error: err.message,
    });
  }
};

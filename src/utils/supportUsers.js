const ADMIN_PHONE = process.env.ADMIN_PHONE || '011111';
const SUPPORT_PHONES = ['022222', '033333'];

const isAdminUser = (user) => user?.phone === ADMIN_PHONE;
const isSupportUser = (user) => SUPPORT_PHONES.includes(user?.phone);

module.exports = {
    ADMIN_PHONE,
    SUPPORT_PHONES,
    isAdminUser,
    isSupportUser
};

const requireBootstrapAccess = async (req, res, next) => {
    const { userId } = req.body; // sent explicitly

    const user = await User.findById(userId);
    if (!user) {
        return res.status(401).json({ message: "Invalid user" });
    }

    if (user.taqeem.bootstrap_used) {
        return res.status(403).json({
            message: "Login required"
        });
    }

    req.bootstrapUser = user;
    next();
};

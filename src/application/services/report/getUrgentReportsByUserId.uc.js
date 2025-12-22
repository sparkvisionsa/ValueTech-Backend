const UrgentReport = require('../../../infrastructure/models/UrgentReport');

const getUrgentReportsByUserIdUC = async (user_id) => {
    try {
        const urgentReports = await UrgentReport.find({ user_id: user_id });
        return {
            success: true,
            message: 'Urgent reports fetched successfully',
            data: urgentReports
        };
    } catch (error) {
        console.error('Error fetching urgent reports by user id:', error);
        throw new Error(`Failed to fetch urgent reports by user id: ${error.message}`);
    }
};

module.exports = { getUrgentReportsByUserIdUC };
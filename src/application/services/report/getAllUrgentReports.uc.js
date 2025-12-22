const UrgentReport = require('../../../infrastructure/models/UrgentReport');

const getAllUrgentReportsUC = async () => {
    try {
        const urgentReports = await UrgentReport.find();
        return {
            success: true,
            message: 'Urgent reports fetched successfully',
            data: urgentReports
        };
    } catch (error) {
        console.error('Error fetching urgent reports:', error);
        throw new Error(`Failed to fetch urgent reports: ${error.message}`);
    }
};

module.exports = { getAllUrgentReportsUC };
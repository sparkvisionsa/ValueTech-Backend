const Report = require("../../../infrastructure/models/report");

const reportExistenceCheckUC = async (report_id) => {
    try {
        const existingReport = await Report.findOne({ report_id: report_id });
        if (existingReport) {
            return {
                success: true,
                message: 'Report already exists',
                data: {
                    report_id: existingReport.report_id,
                    _id: existingReport._id,
                    title: existingReport.title,
                    asset_count: existingReport.asset_data ? existingReport.asset_data.length : 0
                }
            };
        }

        return {
            success: false,
            message: 'Report does not exist'
        };
    } catch (error) {
        console.error('Error checking report existence:', error);
        throw new Error(`Failed to check report existence: ${error.message}`);
    }
};

module.exports = { reportExistenceCheckUC };
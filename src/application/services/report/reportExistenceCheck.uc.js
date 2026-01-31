const Report = require("../../../infrastructure/models/report");

const findReportByCompany = async (report_id, companyOfficeId = null) => {
    const baseQuery = { report_id };
    const officeId = companyOfficeId ? String(companyOfficeId).trim() : "";
    if (!officeId) {
        return Report.findOne(baseQuery);
    }

    const scoped = await Report.findOne({ ...baseQuery, company_office_id: officeId });
    if (scoped) {
        return scoped;
    }

    return Report.findOne({
        ...baseQuery,
        $or: [
            { company_office_id: { $exists: false } },
            { company_office_id: null },
            { company_office_id: "" }
        ]
    });
};

const reportExistenceCheckUC = async (report_id, companyOfficeId = null) => {
    try {
        const existingReport = await findReportByCompany(report_id, companyOfficeId);
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

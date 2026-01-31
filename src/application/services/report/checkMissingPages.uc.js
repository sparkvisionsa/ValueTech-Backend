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

const checkMissingPagesUC = async (report_id, companyOfficeId = null) => {
    try {
        const report = await findReportByCompany(report_id, companyOfficeId);
        if (!report) {
            return {
                success: false,
                message: 'Report does not exist',
            };
        }

        const finalPage = report.pg_count;
        const assetData = report.asset_data || [];

        // Extract all page numbers that actually exist in asset_data
        const existingPages = new Set(
            assetData
                .map(a => parseInt(a.pg_no, 10))
                .filter(n => !isNaN(n))  // ensure valid numbers
        );

        // Check missing pages
        const missingPages = [];
        for (let i = 1; i <= finalPage; i++) {
            if (!existingPages.has(i)) {
                missingPages.push(i);
            }
        }

        return {
            success: true,
            missingPages,
            hasMissing: missingPages.length > 0,
        };

    } catch (error) {
        console.error('Error checking missing pages:', error);
        throw new Error(`Failed to check missing pages: ${error.message}`);
    }
};

module.exports = { checkMissingPagesUC };

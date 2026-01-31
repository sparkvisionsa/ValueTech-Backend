const Report = require('../../../infrastructure/models/report');

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

const addCommonFields = async (report_id, region, city, inspection_date, owner_name, companyOfficeId = null) => {
    try {
        // Step 1: Find existing record with report_id
        const existingReport = await findReportByCompany(report_id, companyOfficeId);

        if (!existingReport) {
            throw new Error(`Report with ID ${report_id} not found in database`);
        }

        console.log(`Found existing report with ${existingReport.asset_data?.length || 0} assets`);

        // Step 2: Update all assets in asset_data array with common values
        const updatedAssetData = existingReport.asset_data.map(asset => {
            return {
                ...asset, // Preserve all existing asset fields
                region: region || asset.region, // Use provided region or keep existing
                city: city || asset.city, // Use provided city or keep existing
                inspection_date: inspection_date || asset.inspection_date, // Use provided date or keep existing
                owner_name: owner_name || asset.owner_name // Use provided owner_name or keep existing
            };
        });

        // Step 3: Update the document
        existingReport.asset_data = updatedAssetData;
        existingReport.updated_at = new Date();

        const saved = await existingReport.save();

        console.log(`Successfully updated report ${report_id} with common fields for ${updatedAssetData.length} assets`);
        console.log(`Common values - Region: ${region}, City: ${city}, Inspection Date: ${inspection_date}`);

        return {
            success: true,
            data: saved,
            message: `Updated ${updatedAssetData.length} assets with common fields`
        };

    } catch (err) {
        console.error("[addCommonFields] error:", err);
        return { success: false, error: err.message };
    }
};

module.exports = { addCommonFields };

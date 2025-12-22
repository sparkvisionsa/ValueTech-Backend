const Report = require("../../../infrastructure/models/report");

const createReportUC = async (report_id, reportData, userContext = {}) => {
    try {
        // Check if report already exists
        console.log("report_id", report_id, "reportData", reportData);
        const existingReport = await Report.findOne({ report_id: report_id });
        if (existingReport) {
            throw new Error('Report already exists');
        }

        // Filter and prepare the data
        const filteredData = {
            report_id: report_id,
            startSubmitTime: new Date(),
            user_id: userContext?.id,
            user_phone: userContext?.phone,
            company: userContext?.company || null
        };

        // If reportData is an array, treat it as asset_data
        if (Array.isArray(reportData)) {
            filteredData.asset_data = processAssetData(reportData);
        } else if (typeof reportData === 'object' && reportData !== null) {
            // Handle basic report info if provided as object
            const basicFields = [
                'title', 'purpose_id', 'value_premise_id', 'report_type',
                'valued_at', 'submitted_at', 'assumptions', 'special_assumptions',
                'value', 'valuation_currency', 'report_asset_file', 'client_name',
                'telephone', 'email', 'has_other_users', 'report_users'
            ];

            basicFields.forEach(field => {
                if (reportData[field] !== undefined && reportData[field] !== null && reportData[field] !== '') {
                    filteredData[field] = reportData[field];
                }
            });

            // Handle valuers array if provided
            if (reportData.valuers && Array.isArray(reportData.valuers) && reportData.valuers.length > 0) {
                filteredData.valuers = reportData.valuers.filter(valuer =>
                    valuer.valuer_name && valuer.contribution_percentage !== undefined
                );
            }

            // Handle asset_data array if provided
            if (reportData.asset_data && Array.isArray(reportData.asset_data) && reportData.asset_data.length > 0) {
                filteredData.asset_data = processAssetData(reportData.asset_data);
            }
        }

        // Create the new report
        const newReport = new Report(filteredData);
        await newReport.save();

        return {
            success: true,
            message: 'Report created successfully',
            data: {
                report_id: newReport.report_id,
                _id: newReport._id,
                title: newReport.title,
                asset_count: newReport.asset_data ? newReport.asset_data.length : 0
            }
        };

    } catch (error) {
        console.error('Error creating report:', error);
        throw new Error(`Failed to create report: ${error.message}`);
    }
};

// Helper function to process asset data
const processAssetData = (assetData) => {
    if (!Array.isArray(assetData) || assetData.length === 0) {
        return [];
    }

    return assetData.map(asset => {
        const filteredAsset = {};

        const assetFields = [
            'id', 'serial_no', 'asset_type', 'asset_name', 'inspection_date', 'pg_no',
            'model', 'owner_name', 'submitState', 'year_made', 'final_value',
            'asset_usage_id', 'value_base', 'production_capacity',
            'production_capacity_measuring_unit', 'product_type', 'market_approach',
            'market_approach_value', 'cost_approach', 'cost_approach_value',
            'country', 'region', 'city'
        ];

        assetFields.forEach(field => {
            if (asset[field] !== undefined && asset[field] !== null && asset[field] !== '') {
                filteredAsset[field] = asset[field];
            }
        });

        // Set defaults for required fields if not provided
        if (!filteredAsset.asset_type) filteredAsset.asset_type = "0";
        if (!filteredAsset.production_capacity) filteredAsset.production_capacity = "0";
        if (!filteredAsset.production_capacity_measuring_unit) filteredAsset.production_capacity_measuring_unit = "0";
        if (!filteredAsset.product_type) filteredAsset.product_type = "0";
        if (!filteredAsset.country) filteredAsset.country = "المملكة العربية السعودية";
        if (filteredAsset.submitState === undefined) filteredAsset.submitState = 0;

        return filteredAsset;
    });
};

module.exports = { createReportUC };

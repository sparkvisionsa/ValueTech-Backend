const { createReportUC } = require('../../application/services/report/uploadAssetsToDB.uc');
const { getAllReportsUC } = require('../../application/services/report/getAllreports.uc');
const { reportExistenceCheckUC } = require('../../application/services/report/reportExistenceCheck.uc');
const { addCommonFields } = require('../../application/services/report/addCommonFields.uc');
const { checkMissingPagesUC } = require('../../application/services/report/checkMissingPages.uc');
const { getReportsByUserIdUC } = require('../../application/services/report/getReportsByUserId.uc');
const Report = require("../../infrastructure/models/report");
const { createNotification } = require('../../application/services/notification/notification.service');
const { extractCompanyOfficeId } = require("../utils/companyOffice");

const reportController = {
    async createReport(req, res) {
        try {
            const { reportId, reportData } = req.body;
            const companyOfficeId = extractCompanyOfficeId(req);
            const { success, message, data } = await createReportUC(
                reportId,
                reportData,
                req.user,
                companyOfficeId
            );

            if (success) {
                res.status(200).json({ success, message, data });
            } else {
                res.status(500).json({ success, message, data });
            }
        } catch (error) {
            console.error('Error creating report:', error);
            res.status(500).json({ success: false, message: error.message });
        }
    },
    async reportExistenceCheck(req, res) {
        try {
            const { reportId } = req.params;
            const companyOfficeId = extractCompanyOfficeId(req);
            const { success, message, data } = await reportExistenceCheckUC(reportId, companyOfficeId);

            if (success) {
                console.log("Success", success, "message", message, "data", data);
                res.status(200).json({ success, message });
            } else if (message === 'Report does not exist') {
                res.status(200).json({ success, message });
            } else {
                console.log("Success", success, "message", message, "data", data);
                res.status(500).json({ success, message });
            }
        } catch (error) {
            console.error('Error checking report existence:', error);
            res.status(500).json({ success: false, message: error.message });
        }
    },


    async getAllReports(req, res) {
        try {
            // Extract pagination and filter parameters from query string
            const {
                page = 1,
                limit = 10,
                status,
                reportType,
                priority,
                startDate,
                endDate,
                search,
                sortBy = 'createdAt',
                sortOrder = 'desc'
            } = req.query;

            console.log(`[getAllReports] Request received with parameters:`, {
                page, limit, status, reportType, priority,
                startDate, endDate, search, sortBy, sortOrder
            });

            // Parse numeric values
            const pageNumber = parseInt(page);
            const limitNumber = parseInt(limit);

            // Validate pagination parameters
            if (isNaN(pageNumber) || isNaN(limitNumber)) {
                return res.status(400).json({
                    success: false,
                    message: 'Page and limit must be valid numbers'
                });
            }

            if (pageNumber < 1) {
                return res.status(400).json({
                    success: false,
                    message: 'Page number must be greater than or equal to 1'
                });
            }

            if (limitNumber < 1) {
                return res.status(400).json({
                    success: false,
                    message: 'Limit must be greater than or equal to 1'
                });
            }

            if (limitNumber > 100) {
                return res.status(400).json({
                    success: false,
                    message: 'Limit cannot exceed 100 items per page'
                });
            }

            // Prepare filters object
            const filters = {};

            // Status filter
            if (status) {
                const validStatuses = ['draft', 'pending', 'in_progress', 'completed', 'archived'];
                if (validStatuses.includes(status)) {
                    filters.status = status;
                } else {
                    return res.status(400).json({
                        success: false,
                        message: `Invalid status. Must be one of: ${validStatuses.join(', ')}`
                    });
                }
            }

            // Report type filter
            if (reportType) {
                filters.reportType = reportType;
            }

            // Priority filter
            if (priority) {
                const validPriorities = ['low', 'medium', 'high', 'critical'];
                if (validPriorities.includes(priority)) {
                    filters.priority = priority;
                } else {
                    return res.status(400).json({
                        success: false,
                        message: `Invalid priority. Must be one of: ${validPriorities.join(', ')}`
                    });
                }
            }

            // Date range filter
            if (startDate || endDate) {
                if (startDate && !isValidDate(startDate)) {
                    return res.status(400).json({
                        success: false,
                        message: 'Invalid startDate format. Use YYYY-MM-DD'
                    });
                }
                if (endDate && !isValidDate(endDate)) {
                    return res.status(400).json({
                        success: false,
                        message: 'Invalid endDate format. Use YYYY-MM-DD'
                    });
                }
                if (startDate) filters.startDate = startDate;
                if (endDate) filters.endDate = endDate;
            }

            // Search filter
            if (search && search.trim()) {
                filters.search = search.trim();
            }

            // Sort validation
            const validSortFields = ['createdAt', 'updatedAt', 'title', 'status', 'priority', 'reportType'];
            if (sortBy && !validSortFields.includes(sortBy)) {
                return res.status(400).json({
                    success: false,
                    message: `Invalid sort field. Must be one of: ${validSortFields.join(', ')}`
                });
            }

            if (sortOrder && !['asc', 'desc'].includes(sortOrder.toLowerCase())) {
                return res.status(400).json({
                    success: false,
                    message: 'Invalid sort order. Must be "asc" or "desc"'
                });
            }

            console.log(`[getAllReports] Calling use case with:`, {
                page: pageNumber,
                limit: limitNumber,
                sortBy,
                sortOrder,
                filters
            });

            // Call the use case with all parameters
            const result = await getAllReportsUC({
                page: pageNumber,
                limit: limitNumber,
                sortBy,
                sortOrder,
                ...filters
            });

            console.log(`[getAllReports] Successfully fetched ${result.data.length} reports out of ${result.pagination.totalItems} total`);

            res.status(200).json(result);

        } catch (error) {
            console.error('[getAllReports] Error fetching reports:', error);
            res.status(500).json({
                success: false,
                message: `Failed to fetch reports: ${error.message}`
            });
        }
    },

    async getReportsByUserId(req, res) {
        try {
            const userId = req.userId;
            console.log("userId", userId);

            const { success, message, data, pagination } =
                await getReportsByUserIdUC({
                    userId,
                    page: req.query.page,
                    limit: req.query.limit,
                    sortBy: req.query.sortBy,
                    sortOrder: req.query.sortOrder,
                    ...req.query
                });

            if (success) {
                return res.status(200).json({ success, message, data, pagination });
            }

            return res.status(500).json({ success, message, data });

        } catch (error) {
            console.error('Error fetching reports by user id:', error);
            return res.status(500).json({
                success: false,
                message: error.message
            });
        }
    },


    async checkMissingPages(req, res) {
        try {
            const { reportId } = req.params;
            const companyOfficeId = extractCompanyOfficeId(req);
            const { success, missingPages, hasMissing } = await checkMissingPagesUC(reportId, companyOfficeId);

            res.status(200).json({ success, missingPages, hasMissing });

        } catch (error) {
            console.error('Error checking missing pages:', error);
            res.status(500).json({ success: false, message: error.message });
        }
    },

    async addCommonFields(req, res) {
        try {
            const { reportId, region, city, inspectionDate, ownerName } = req.body;
            const companyOfficeId = extractCompanyOfficeId(req);
            const { success, message, data } = await addCommonFields(reportId, region, city, inspectionDate, ownerName, companyOfficeId);

            if (success) {
                res.status(200).json({ success, message, data });
            } else {
                res.status(500).json({ success, message, data });
            }
        } catch (error) {
            console.error('Error adding common fields:', error);
            res.status(500).json({ success: false, message: error.message });
        }
    },
    async createReportWithCommonFields(req, res) {
        try {
            const { reportId, reportData, commonFields = {}, reportStatus, storeOnly } = req.body;
            const userId = req.userId;

            if (!reportId || !reportId.trim()) {
                return res.status(400).json({
                    success: false,
                    message: 'Report ID is required'
                });
            }

            const rawRows = Array.isArray(reportData)
                ? reportData
                : Array.isArray(reportData?.asset_data)
                    ? reportData.asset_data
                    : [];

            if (!Array.isArray(rawRows) || rawRows.length === 0) {
                return res.status(400).json({
                    success: false,
                    message: 'Report data is required and must be a non-empty array'
                });
            }

            const { region, city, inspectionDate, ownerName } = commonFields;

            const enhancedReportData = rawRows.map(entry => {
                const enhancedEntry = { ...entry };

                if (inspectionDate) enhancedEntry.inspection_date = inspectionDate;
                if (region) enhancedEntry.region = region;
                if (city) enhancedEntry.city = city;
                if (ownerName) enhancedEntry.owner_name = ownerName;

                enhancedEntry.asset_type = enhancedEntry.asset_type || '0';
                enhancedEntry.production_capacity = enhancedEntry.production_capacity || '0';
                enhancedEntry.production_capacity_measuring_unit = enhancedEntry.production_capacity_measuring_unit || '0';
                enhancedEntry.product_type = enhancedEntry.product_type || '0';
                enhancedEntry.country = enhancedEntry.country || 'المملكة العربية السعودية';
                enhancedEntry.submitState = enhancedEntry.submitState || 0;

                Object.keys(enhancedEntry).forEach(key => {
                    if (enhancedEntry[key] === undefined || enhancedEntry[key] === null) {
                        delete enhancedEntry[key];
                    }
                });

                return enhancedEntry;
            });

            const storeOnlyFlag = storeOnly === true || storeOnly === 'true';
            const normalizedStatus = (reportStatus || (storeOnlyFlag ? 'DRAFT' : '')).toString().trim();
            const payload = normalizedStatus
                ? { asset_data: enhancedReportData, report_status: normalizedStatus }
                : enhancedReportData;

            const companyOfficeId = extractCompanyOfficeId(req);
            const { success, message, data } = await createReportUC(
                reportId.trim(),
                payload,
                userId,   // ONLY user id
                companyOfficeId
            );

            if (success) {
                try {
                    await createNotification({
                        userId,
                        type: 'report',
                        level: 'success',
                        title: 'Report created',
                        message: `Report ${reportId.trim()} created successfully.`,
                        data: {
                            reportId: reportId.trim(),
                            view: 'upload-assets',
                            action: 'created'
                        }
                    });
                } catch (notifyError) {
                    console.warn('Failed to create report notification', notifyError);
                }
                return res.status(200).json({
                    success,
                    message,
                    data: {
                        ...data,
                        recordCount: enhancedReportData.length,
                    }
                });
            }

            return res.status(500).json({
                success,
                message: message || `Failed to create report '${reportId}'`,
                data
            });

        } catch (error) {
            console.error('[createReportWithCommonFields] Error:', error);
            try {
                if (req.userId) {
                    const failedId = String(req.body?.reportId || '').trim();
                    await createNotification({
                        userId: req.userId,
                        type: 'report',
                        level: 'danger',
                        title: 'Report failed',
                        message: failedId
                            ? `Report ${failedId} failed to upload.`
                            : 'Report upload failed.',
                        data: {
                            reportId: failedId || undefined,
                            view: 'upload-assets',
                            action: 'failed'
                        }
                    });
                }
            } catch (notifyError) {
                console.warn('Failed to create report failure notification', notifyError);
            }
            return res.status(500).json({
                success: false,
                message: `Internal server error: ${error.message}`
            });
        }
    },
    async updateAsset(req, res) {
        try {
            const { reportId, assetUid } = req.params;
            const update = req.body;

            if (!reportId || !assetUid) {
                return res.status(400).json({
                    success: false,
                    message: "Report ID and asset UID are required"
                });
            }

            // Do not allow identity changes
            delete update.internal_uid;
            delete update._id;

            const setPayload = Object.entries(update).reduce((acc, [key, value]) => {
                acc[`asset_data.$.${key}`] = value;
                return acc;
            }, {});

            // Force submitState -> 0
            setPayload["asset_data.$.submitState"] = 0;

            const result = await Report.updateOne(
                {
                    _id: reportId,
                    "asset_data.internal_uid": assetUid
                },
                { $set: setPayload }
            );

            if (result.matchedCount === 0) {
                return res.status(404).json({
                    success: false,
                    message: "Asset not found on this report"
                });
            }

            await Report.updateOne(
                {
                    _id: reportId
                },
                { $set: { "report_status": "INCOMPLETE" } }
            )

            return res.status(200).json({
                success: true,
                message: "Asset updated successfully and submit state reset"
            });

        } catch (error) {
            console.error("[updateAsset] Error:", error);
            return res.status(500).json({
                success: false,
                message: error.message
            });
        }
    }


};

module.exports = reportController;

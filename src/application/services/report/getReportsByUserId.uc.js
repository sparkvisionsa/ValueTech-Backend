const Report = require('../../../infrastructure/models/report');

const getReportsByUserIdUC = async ({
    userId,
    page = 1,
    limit = 10,
    sortBy = 'createdAt',
    sortOrder = 'desc',
    ...filters
}) => {
    try {
        if (!userId) {
            throw new Error('userId is required');
        }

        const skip = (page - 1) * limit;

        // Base query scoping by userId
        let query = { user_id: userId };

        if (filters.status) {
            query.status = filters.status;
        }

        if (filters.report_status) {
            query.report_status = filters.report_status;
        }

        const companyOfficeId =
            filters.companyOfficeId ||
            filters.company_office_id ||
            filters.officeId ||
            filters.office_id;
        if (companyOfficeId) {
            query.company_office_id = String(companyOfficeId).trim();
        }

        const excludeRaw = filters.excludeReportStatus || filters.exclude_report_status;
        if (excludeRaw && !query.report_status) {
            const excludeList = String(excludeRaw)
                .split(',')
                .map((value) => value.trim())
                .filter(Boolean);
            if (excludeList.length > 0) {
                query.report_status = { $nin: excludeList };
            }
        }

        if (filters.reportType) {
            query.reportType = filters.reportType;
        }

        if (filters.priority) {
            query.priority = filters.priority;
        }

        if (filters.startDate && filters.endDate) {
            query.createdAt = {
                $gte: new Date(filters.startDate),
                $lte: new Date(filters.endDate),
            };
        }

        if (filters.search) {
            query.$or = [
                { title: { $regex: filters.search, $options: 'i' } },
                { description: { $regex: filters.search, $options: 'i' } },
            ];
        }

        const sortObject = {};
        sortObject[sortBy] = sortOrder === 'asc' ? 1 : -1;

        console.log('[getReportsByUserIdUC] Query:', JSON.stringify(query));
        console.log('[getReportsByUserIdUC] Skip:', skip, 'Limit:', limit);
        console.log('[getReportsByUserIdUC] Sort:', sortObject);

        const reports = await Report.find(query)
            .sort(sortObject)
            .skip(skip)
            .limit(limit);

        const totalReports = await Report.countDocuments(query);
        const totalPages = Math.ceil(totalReports / limit);

        console.log(
            '[getReportsByUserIdUC] Found',
            reports.length,
            'reports out of',
            totalReports,
            'total'
        );

        return {
            success: true,
            message: 'User reports fetched successfully',
            data: reports,
            pagination: {
                currentPage: page,
                totalPages,
                totalItems: totalReports,
                itemsPerPage: limit,
                hasNextPage: page < totalPages,
                hasPreviousPage: page > 1,
            },
        };
    } catch (error) {
        console.error('Error fetching user reports:', error);
        throw new Error(`Failed to fetch user reports: ${error.message}`);
    }
};

module.exports = { getReportsByUserIdUC };

const mongoose = require("mongoose");
const { getElectronDbConnection } = require("../electronDb");

// ── Sub-schemas ───────────────────────────────────────────────────────────────

const AvailableServicesSchema = new mongoose.Schema(
  {
    electricity: { type: mongoose.Schema.Types.Mixed, default: null },
    electricityUnits: { type: mongoose.Schema.Types.Mixed, default: null },
    sanitaryDrainage: { type: mongoose.Schema.Types.Mixed, default: null },
    telephoneLine: { type: mongoose.Schema.Types.Mixed, default: null },
    waterMetersCount: { type: mongoose.Schema.Types.Mixed, default: null },
    electricityMetersCount: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
  },
  { _id: false },
);

const BuildingConditionSchema = new mongoose.Schema(
  {
    status: { type: String, default: "" },
    completionPct: { type: mongoose.Schema.Types.Mixed, default: null },
    otherText: { type: String, default: "" },
  },
  { _id: false },
);

const EvalDataSchema = new mongoose.Schema(
  {
    status: { type: String, default: "new" },

    // location & classification
    regionId: String,
    regionName: String,
    cityId: String,
    cityName: String,
    neighborhoodId: String,
    neighborhoodName: String,
    opponentStatements: String,
    assetCategoryId: String,
    propertyTypeId: String,

    address: String,
    inspector: String,
    contactNo: String,
    reviewer: String,

    landTitle: String,
    landSpace: String,

    // basic property data
    propertyCode: String,
    deedNumber: String,
    deedDate: String,
    ownerName: String,
    clientName: String,
    authorizedName: String,
    propertyType: String,
    landUse: String,

    // boundaries
    northBoundary: String,
    northLength: String,
    southBoundary: String,
    southLength: String,
    eastBoundary: String,
    eastLength: String,
    westBoundary: String,
    westLength: String,

    // finishing
    buildingCondition: { type: BuildingConditionSchema, default: () => ({}) },
    floorsCount: String,
    propertyAge: String,
    finishLevel: String,
    buildQuality: String,

    street: String,
    availableServices: { type: AvailableServicesSchema, default: () => ({}) },
    surroundingEnvironment: [String],

    // map
    coords: String,
    lat: String,
    lng: String,
    zoomMap: String,
    zoomAerial: String,
    zoomComparisons: String,

    // appraiser opinion
    evalDate: String,
    completedDate: String,
    reportDate: String,
    finalAssetValue: String,
    appraiserDesc: String,
    appraiserNotes: String,

    // valuation — market
    marketMeterPrice: String,
    marketWeightPct: String,
    marketMethodTotal: String,
    marketReason: String,
    propertyArea: String,
    propertyAreaMethod: String,

    // valuation — cost
    costNetBuildings: String,
    costNetLandPrice: String,
    costLandBuildTotal: String,
    costReason: String,

    // valuation — income
    incomeTotal: String,
    incomeReason: String,

    // report items
    standards: String,
    scope: String,
    assumptions: String,
    risks: String,

    // authors
    author1Id: String,
    author1Title: String,
    author2Id: String,
    author2Title: String,
    author3Id: String,
    author3Title: String,
    author4Id: String,
    author4Title: String,

    // tables
    comparisonRows: { type: Array, default: [] },
    section1Rows: { type: Array, default: [] },
    settlementRows: { type: Array, default: [] },
    settlementBases: { type: Array, default: [] },
    settlementWeights: { type: Array, default: [] },

    // replacement cost
    replacementLines: { type: Array, default: [] },
    meterPriceLand: String,
    managementPct: String,
    professionalPct: String,
    utilityNetworkPct: String,
    emergencyPct: String,
    financePct: String,
    yearDev: String,
    earningsRate: String,
    buildAge: String,
    defaultAge: String,
    depreciationPct: String,
    economicPct: String,
    careerPct: String,
    maintenancePrice: String,
    finishesPrice: String,
    maintenanceDesc: String,
    finishesDesc: String,
    replacementNotes: String,
    investmentEntries: { type: Array, default: [] },
    residualValueEntries: { type: Array, default: [] },
    dcfEntries: { type: Array, default: [] },
    rentalValueEntries: { type: Array, default: [] },

    subDivisionRecordNumber: String,
    otherUsers: String,
    deedSource: String,
    buildingLicense: String,
    buildingLicenseDate: String,
    elevation: String,
    inspectionBoundaries: String,
    completionPct: String,

    previousDeedNumber: String,
    previousDeedDate: String,
    operationType: String,
    propertyStatus: String,
    restrictions: String,
    ownerId: String,
    ownerNationality: String,
    ownershipPercentage: String,
    propertyId: String,
    parcelNumber: String,
    blockNumber: String,
    districtPart: String,
    propertyModel: String,
    locationDescription: String,
    planNumber: String,
  },
  { _id: false },
);

// ── Main schema ───────────────────────────────────────────────────────────────

const TransactionSchema = new mongoose.Schema(
  {
    assignmentNumber: String,
    authorizationNumber: String,
    assignedInspectorIds: { type: [String], default: [] },
    createdByUserId: { type: String, default: null },
    companyId: { type: String, default: null },
    assignmentDate: String,
    valuationPurpose: String,
    intendedUse: String,
    valuationBasis: String,
    priority: { type: String, default: "normal" },
    attachmentsCount: { type: Number, default: 0 },
    imagesCount: { type: Number, default: 0 },
    ownershipType: String,
    valuationHypothesis: String,
    clientId: String,
    branch: String,
    templateId: { type: String, default: null },

    templateFieldValues: { type: mongoose.Schema.Types.Mixed, default: {} },
    evalData: { type: EvalDataSchema, default: () => ({}) },

    isOpened: { type: Boolean, default: false },
    isCompleted: { type: Boolean, default: false },

    reportId: { type: String, default: null },
    submitState: { type: Number, default: 0 },
  },
  {
    collection: "transactions", // must match the first app's collection name
    timestamps: true, // maps to createdAt / updatedAt
  },
);

// ── Attach model to the ElectronDB connection ─────────────────────────────────
// Using getElectronDbConnection() ensures this model always queries ElectronDB,
// never the default mongoose connection used by the rest of this app.

const conn = getElectronDbConnection();
const Transaction = conn.model("Transaction", TransactionSchema);

module.exports = Transaction;

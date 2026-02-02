const mongoose = require("mongoose");

const PriceSchema = new mongoose.Schema(
  {
    formattedPrice: { type: String, default: null },
    numeric: { type: Number, default: null, index: true },
  },
  { _id: false }
);

const ItemSchema = new mongoose.Schema(
  {
    id: { type: Number, default: null },
    title: { type: String, default: null },
    postDate: { type: Number, default: null, index: true }, // unix seconds
    updateDate: { type: Number, default: null },
    authorUsername: { type: String, default: null },
    authorId: { type: Number, default: null },
    URL: { type: String, default: null },
    bodyTEXT: { type: String, default: null },
    city: { type: String, default: null },
    geoCity: { type: String, default: null },
    geoNeighborhood: { type: String, default: null },
    tags: { type: [String], default: [] },
    imagesList: { type: [String], default: [] },
    hasImage: { type: Boolean, default: null },
    hasVideo: { type: Boolean, default: null },
    commentEnabled: { type: Boolean, default: null },
    commentStatus: { type: Number, default: null },
    commentCount: { type: Number, default: null },
    status: { type: Boolean, default: null },
    postType: { type: String, default: null },
    price: { type: PriceSchema, default: null },
  },
  { _id: false }
);

const CommentSchema = new mongoose.Schema(
  {
    id: { type: Number, default: null },
    authorUsername: { type: String, default: null },
    authorId: { type: Number, default: null },
    authorLevel: { type: Number, default: null },
    body: { type: String, default: null },
    status: { type: Number, default: null }, // 1 visible, 0 hidden
    deleteReason: { type: String, default: null },
    seqId: { type: Number, default: null },
    date: { type: Number, default: null }, // unix seconds
    isReply: { type: Boolean, default: false },
    replyToCommentId: { type: Number, default: 0 },
    mention: { type: mongoose.Schema.Types.Mixed, default: null },
  },
  { _id: false }
);

const HarajScrapeSchema = new mongoose.Schema(
  {
    _id: { type: String }, // postId
    postId: { type: String, index: true },

    url: { type: String, default: null },
    phone: { type: String, default: null },

    firstSeenAt: { type: Date, index: true },
    lastSeenAt: { type: Date, index: true },

    // normalized
    item: { type: ItemSchema, default: null },
    comments: { type: [CommentSchema], default: [] },
    commentsCount: { type: Number, default: 0 },
    visibleCommentsCount: { type: Number, default: 0 },
    commentsLastFetchedAt: { type: Date, default: null },

    // flattened fields for fast queries
    title: { type: String, default: null },
    postDate: { type: Number, default: null, index: true },
    tags: { type: [String], default: [] },
    city: { type: String, default: null },
    priceNumeric: { type: Number, default: null },
    hasPrice: { type: Boolean, default: false, index: true },

    // raw payloads (optional)
    gql: { type: mongoose.Schema.Types.Mixed, default: null },
    commentsGql: { type: mongoose.Schema.Types.Mixed, default: null },
  },
  { timestamps: true, collection: "harajScrape" } // ✅ uses your exact collection name
);

/* ---------------- Indexes (auto create) ---------------- */

// Sort by Haraj "created date"
HarajScrapeSchema.index({ postDate: -1 });

// Tag filtering
HarajScrapeSchema.index({ tags: 1 });

// Price filtering
HarajScrapeSchema.index({ priceNumeric: 1 });

// City filtering
HarajScrapeSchema.index({ city: 1 });

// Title search (text index) — Arabic: set default_language none
HarajScrapeSchema.index(
  { title: "text" },
  { default_language: "none" }
);

module.exports = mongoose.model("HarajScrape", HarajScrapeSchema);


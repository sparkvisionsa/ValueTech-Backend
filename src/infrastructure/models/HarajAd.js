const mongoose = require("mongoose");

const CommentSchema = new mongoose.Schema(
  {
    commentId: { type: String, index: true },
    order: String,
    user: String,
    userHref: String,
    timeText: String,
    text: String,
    firstSeenAt: Date,
    lastSeenAt: Date,
  },
  { _id: false }
);

const BreadcrumbSchema = new mongoose.Schema(
  {
    position: Number,
    name: String,
    href: String,
  },
  { _id: false }
);

const ContactSchema = new mongoose.Schema(
  {
    phone: String,
    note: String,
  },
  { _id: false }
);

const HarajAdSchema = new mongoose.Schema(
  {
    adId: { type: Number, unique: true, index: true, required: true },
    url: { type: String, index: true },

    breadcrumbs: [BreadcrumbSchema],
    breadcrumbKey: { type: String, index: true },
    breadcrumbNames: [{ type: String }],

    title: { type: String, index: true },
    city: { type: String, index: true },
    priceText: { type: String, index: true },
    priceValue: { type: Number, index: true },
    postedTimeText: String,
    author: { type: String, index: true },
    authorHref: String,
    description: { type: String, index: true },

    contact: ContactSchema,

    comments: [CommentSchema],

    status: { type: String, enum: ["ACTIVE", "REMOVED"], default: "ACTIVE", index: true },
    removedAt: Date,
    removedReason: String,

    firstSeenAt: { type: Date, index: true },
    lastSeenAt: { type: Date, index: true },
    lastCommentsCheckAt: { type: Date, index: true },
  },
  { timestamps: true, collection: "harajAds" }
);
HarajAdSchema.index({ status: 1, breadcrumbKey: 1 });
HarajAdSchema.index({ breadcrumbNames: 1 });
HarajAdSchema.index({ status: 1, createdAt: -1 });

// Text search (fast + simple)
HarajAdSchema.index({
  title: "text",
  description: "text",
  author: "text",
  city: "text",
  "comments.text": "text",
  "comments.user": "text",
});

module.exports = mongoose.model("HarajAd", HarajAdSchema);

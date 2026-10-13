// Data that flows in from installed apps (feedback, crash reports) and out to
// them (announcements). Managed from the admin panel.
const mongoose = require('mongoose');

const feedbackSchema = new mongoose.Schema({
  kind: { type: String, enum: ['idea', 'bug', 'love', 'other'], default: 'other' },
  message: { type: String, required: true },
  email: { type: String, default: '' },          // only if the user chose to leave one
  appVersion: { type: String, default: '' },
  os: { type: String, default: '' },
  status: { type: String, enum: ['new', 'read', 'done'], default: 'new' },
}, { timestamps: true });
feedbackSchema.index({ status: 1, createdAt: -1 });

// Identical crashes are grouped by fingerprint and counted instead of stored twice.
const crashSchema = new mongoose.Schema({
  fingerprint: { type: String, required: true, unique: true },
  source: { type: String, enum: ['main', 'renderer', 'pet'], default: 'main' },
  message: { type: String, default: '' },
  stack: { type: String, default: '' },
  appVersion: { type: String, default: '' },
  os: { type: String, default: '' },
  count: { type: Number, default: 1 },
  firstAt: { type: Date, default: Date.now },
  lastAt: { type: Date, default: Date.now },
  resolved: { type: Boolean, default: false },
});
crashSchema.index({ resolved: 1, lastAt: -1 });

const announcementSchema = new mongoose.Schema({
  title: { type: String, required: true },
  body: { type: String, default: '' },
  link: { type: String, default: '' },
  active: { type: Boolean, default: true },
  startsAt: { type: Date, default: null },
  endsAt: { type: Date, default: null },
}, { timestamps: true });

const Feedback = mongoose.models.Feedback || mongoose.model('Feedback', feedbackSchema);
const Crash = mongoose.models.Crash || mongoose.model('Crash', crashSchema);
const Announcement = mongoose.models.Announcement || mongoose.model('Announcement', announcementSchema);

module.exports = { Feedback, Crash, Announcement };

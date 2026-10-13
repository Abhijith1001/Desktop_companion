const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  passwordHash: { type: String, required: true },
  preferences: {
    character: { type: String, default: 'dog' },
    theme: { type: String, default: 'system' },
    timeZone: { type: String, default: 'UTC' },
  },
}, { timestamps: true });

// Task ids are UUIDs generated on the device, which makes creation idempotent
// across retries and devices.
const taskSchema = new mongoose.Schema({
  _id: { type: String, required: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  title: { type: String, default: '' },
  description: { type: String, default: '' },
  notes: { type: String, default: '' },
  link: { type: String, default: '' },
  category: { type: String, default: '' },
  priority: { type: String, enum: ['LOW', 'MEDIUM', 'HIGH'], default: 'MEDIUM' },
  status: { type: String, enum: ['PENDING', 'COMPLETED', 'CANCELLED'], default: 'PENDING' },
  dueAt: { type: Date, default: null },
  timeZone: { type: String, default: 'UTC' },
  recurrence: { type: mongoose.Schema.Types.Mixed, default: null },
  leadMinutes: { type: Number, default: 0 },
  nextOccurrenceAt: { type: Date, default: null },
  snoozedUntil: { type: Date, default: null },
  createdAt: { type: Date, required: true },
  updatedAt: { type: Date, required: true },      // device clock, used for last-writer-wins
  completedAt: { type: Date, default: null },
  deletedAt: { type: Date, default: null },        // tombstone
  serverUpdatedAt: { type: Date, required: true }, // server clock, used for change feeds
  version: { type: Number, default: 0 },
}, { versionKey: false });
taskSchema.index({ userId: 1, serverUpdatedAt: 1, _id: 1 });
taskSchema.index({ userId: 1, status: 1, nextOccurrenceAt: 1 });
taskSchema.index({ userId: 1, deletedAt: 1, dueAt: 1 });

// Remembers processed sync operations so retried requests are not re-applied.
const processedOpSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, required: true },
  opId: { type: String, required: true },
  result: { type: mongoose.Schema.Types.Mixed },
  createdAt: { type: Date, default: Date.now, expires: 60 * 60 * 24 * 30 },
});
processedOpSchema.index({ userId: 1, opId: 1 }, { unique: true });

const User = mongoose.models.User || mongoose.model('User', userSchema);
const Task = mongoose.models.Task || mongoose.model('Task', taskSchema);
const ProcessedOp = mongoose.models.ProcessedOp || mongoose.model('ProcessedOp', processedOpSchema);

module.exports = { User, Task, ProcessedOp };

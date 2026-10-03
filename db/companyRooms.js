const mongoose = require("mongoose");
const schema = new mongoose.Schema({
  id: { type: String, unique: true, required: true },
  public: { type: Boolean, required: true, index: true },
  phase: { type: String, required: true, index: true },
  version: { type: Number, default: 0 },
  state: { type: mongoose.Schema.Types.Mixed, required: true },
  updatedAt: { type: Date, required: true, index: true },
}, { minimize: false });
module.exports = mongoose.models.CompanyRoom || mongoose.model("CompanyRoom", schema);

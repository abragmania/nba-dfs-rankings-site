// server/lib/atomic.js for the public site: one storage write is whole by itself, so there is no temp file to rename.
import fs from "./fs.js";

export const writeFileAtomic = (file, data) => fs.writeFileSync(file, data);

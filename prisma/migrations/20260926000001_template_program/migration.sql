-- Add program field to templates for program-specific templates
ALTER TABLE "TitleTemplate" ADD COLUMN "program" "Program";
ALTER TABLE "DescriptionTemplate" ADD COLUMN "program" "Program";

-- Add index for program-based template lookup
CREATE INDEX "TitleTemplate_program_idx" ON "TitleTemplate"("program");
CREATE INDEX "DescriptionTemplate_program_idx" ON "DescriptionTemplate"("program");

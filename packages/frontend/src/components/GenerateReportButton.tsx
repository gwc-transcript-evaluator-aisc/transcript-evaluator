import { FileDown, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { FinalDecision } from "./FinalDecisionCard";

interface GenerateReportButtonProps {
  studentName: string;
  onGenerate: () => void;
  coursesReviewed: number;
  totalCourses: number;
  hasOverrides: boolean;
  finalDecision: FinalDecision;
  isSubmitted: boolean;
}

export function GenerateReportButton({
  studentName,
  onGenerate,
  coursesReviewed,
  totalCourses,
  hasOverrides,
  finalDecision,
  isSubmitted,
}: GenerateReportButtonProps) {
  const allReviewed = coursesReviewed === totalCourses;
  const reportQuality = allReviewed
    ? hasOverrides
      ? "Complete with overrides — report will flag manual override notes for department review."
      : "Complete — all courses reviewed and decisions confirmed by evaluator."
    : `Partial — ${coursesReviewed} of ${totalCourses} courses reviewed. Remaining courses will appear as pending in the report.`;

  const getDecisionLabel = () => {
    if (!finalDecision) return "Pending";
    if (finalDecision === "approved") return "Approved";
    if (finalDecision === "denied") return "Denied";
    return "Override";
  };

  return (
    <Dialog>
      <Tooltip>
        <TooltipTrigger asChild>
          <DialogTrigger asChild>
            <Button
              className="bg-gwc-gold hover:bg-gwc-gold-dark text-black font-semibold shadow-md"
              size="lg"
            >
              <FileDown className="h-4 w-4 mr-2" />
              Generate Report
            </Button>
          </DialogTrigger>
        </TooltipTrigger>
        <TooltipContent>Generate the final evaluation report</TooltipContent>
      </Tooltip>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Generate Evaluation Report</DialogTitle>
          <DialogDescription>
            This will generate a comprehensive evaluation report for{" "}
            <strong>{studentName}</strong>.
          </DialogDescription>
        </DialogHeader>

        {/* Report Quality */}
        <Alert variant={allReviewed ? "success" : "warning"} className="my-2">
          <Info className="h-4 w-4" />
          <AlertTitle className="text-sm">Report Quality</AlertTitle>
          <AlertDescription className="text-xs">
            {reportQuality}
          </AlertDescription>
        </Alert>

        {/* Evaluator Decision Section */}
        <div className="rounded-md border p-3 space-y-2">
          <p className="text-xs font-semibold uppercase text-muted-foreground tracking-wide">
            Evaluator Decision
          </p>
          <Separator />
          <div className="space-y-1.5 text-sm">
            <div className="flex justify-between items-center">
              <span className="text-muted-foreground">Final Decision:</span>
              <Badge
                variant={
                  finalDecision === "approved" ? "success"
                    : finalDecision === "denied" ? "error"
                    : finalDecision === "override" ? "warning"
                    : "secondary"
                }
              >
                {getDecisionLabel()}
              </Badge>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-muted-foreground">Date Submitted:</span>
              <span className="text-xs font-medium">
                {isSubmitted ? new Date().toLocaleDateString() : "—"}
              </span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-muted-foreground">Evaluator Name:</span>
              <span className="text-xs font-medium">Current Evaluator</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-muted-foreground">Evaluation Status:</span>
              <span className={`text-xs font-medium ${isSubmitted ? "text-green-700" : "text-yellow-700"}`}>
                {isSubmitted ? "Submitted" : "Pending"}
              </span>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline">Cancel</Button>
          <Button
            className="bg-gwc-gold hover:bg-gwc-gold-dark text-black"
            onClick={onGenerate}
          >
            Generate Report
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

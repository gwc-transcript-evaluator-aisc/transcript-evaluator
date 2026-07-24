import { useState } from "react";
import { CheckCircle2, XCircle, AlertTriangle, Bot, UserCheck, Mail, ShieldAlert } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { OriginalCourseCard } from "./OriginalCourseCard";
import { EquivalentCourseCard } from "./EquivalentCourseCard";
import { CourseDescriptionDialog } from "./CourseDescriptionDialog";
import { CourseComparison } from "@/types/course";

interface CourseComparisonWorkspaceProps {
  comparison: CourseComparison;
  onDecisionsChange?: (decisions: Record<string, EvaluatorDecision>) => void;
}

export type EvaluatorDecision = "agree" | "override" | "email" | null;

const CRITERIA_MARKERS = ["①", "②", "③", "④"];

export function CourseComparisonWorkspace({ comparison, onDecisionsChange }: CourseComparisonWorkspaceProps) {
  const [evaluatorDecisions, setEvaluatorDecisions] = useState<Record<string, EvaluatorDecision>>({});
  const [emailDialogOpen, setEmailDialogOpen] = useState(false);
  const [counselorEmail, setCounselorEmail] = useState("");
  const [emailSent, setEmailSent] = useState(false);
  const [descriptionDialogOpen, setDescriptionDialogOpen] = useState(false);

  const handleEvaluatorAgree = (field: string) => {
    const current = evaluatorDecisions[field];
    const newVal = current === "agree" ? null : "agree" as EvaluatorDecision;
    const updated = { ...evaluatorDecisions, [field]: newVal };
    setEvaluatorDecisions(updated);
    onDecisionsChange?.(updated);
  };

  const handleEvaluatorOverride = (field: string) => {
    const current = evaluatorDecisions[field];
    const newVal = current === "override" ? null : "override" as EvaluatorDecision;
    const updated = { ...evaluatorDecisions, [field]: newVal };
    setEvaluatorDecisions(updated);
    onDecisionsChange?.(updated);
  };

  const handleEvaluatorEmail = (field: string) => {
    const current = evaluatorDecisions[field];
    const newVal = current === "email" ? null : "email" as EvaluatorDecision;
    const updated = { ...evaluatorDecisions, [field]: newVal };
    setEvaluatorDecisions(updated);
    onDecisionsChange?.(updated);
    if (newVal === "email") {
      setEmailDialogOpen(true);
    }
  };

  const sendCounselorEmail = () => {
    setEmailSent(true);
    setTimeout(() => {
      setEmailDialogOpen(false);
      setEmailSent(false);
      setCounselorEmail("");
    }, 1500);
  };

  return (
    <div className="space-y-4">
      {/* Title Bar */}
      <Card>
        <CardHeader className="py-3">
          <CardTitle className="text-center text-lg">
            Side-by-Side Course Comparison
          </CardTitle>
        </CardHeader>
      </Card>

      {/* Course Cards — side by side */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <OriginalCourseCard course={comparison.transferCourse} />
        <EquivalentCourseCard course={comparison.equivalentCourse} />
      </div>

      {/* Evaluation Criteria Matrix */}
      <Card className="border-2 border-primary/20">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center justify-between">
            <span>Evaluation Criteria</span>
            <p className="text-[10px] text-muted-foreground font-normal">
              Markers ①②③ link to the explanation panel →
            </p>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {/* Table Header */}
          <div className="grid grid-cols-[auto_1fr_100px_180px] gap-2 items-center pb-2 border-b text-[10px] uppercase tracking-wide font-semibold text-muted-foreground">
            <span className="w-5"></span>
            <span>Criteria</span>
            <span className="text-center flex items-center justify-center gap-1">
              <Bot className="h-3 w-3 text-blue-600" /> AI Review
            </span>
            <span className="text-center flex items-center justify-center gap-1">
              <UserCheck className="h-3 w-3 text-purple-600" /> Evaluator
            </span>
          </div>

          {/* Criteria Rows */}
          <div className="divide-y">
            {comparison.evaluationCriteria.map((criterion, index) => {
              const decision = evaluatorDecisions[criterion.field];
              const isDescriptionField = criterion.field === "Course Description";

              return (
                <div
                  key={criterion.field}
                  className="grid grid-cols-[auto_1fr_100px_180px] gap-2 items-center py-3"
                >
                  {/* Marker */}
                  <span className="text-sm font-bold text-blue-600 w-5">
                    {CRITERIA_MARKERS[index]}
                  </span>

                  {/* Criteria name */}
                  <div>
                    {isDescriptionField ? (
                      <button
                        onClick={() => setDescriptionDialogOpen(true)}
                        className="text-sm font-medium text-blue-700 hover:text-blue-900 underline decoration-dashed underline-offset-2 cursor-pointer"
                        aria-label="Open course description comparison"
                      >
                        {criterion.field}
                      </button>
                    ) : (
                      <span className="text-sm font-medium">{criterion.field}</span>
                    )}
                    {criterion.status === "error" && (
                      <span className="ml-2 text-[10px] text-red-500">⚠ Error</span>
                    )}
                  </div>

                  {/* AI Review indicator */}
                  <div className="flex justify-center">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <div>
                          {criterion.status === "approved" ? (
                            <CheckCircle2 className="h-5 w-5 text-green-600" />
                          ) : criterion.status === "warning" ? (
                            <AlertTriangle className="h-5 w-5 text-yellow-500" />
                          ) : (
                            <XCircle className="h-5 w-5 text-red-500" />
                          )}
                        </div>
                      </TooltipTrigger>
                      <TooltipContent side="top" className="max-w-[220px]">
                        <p className="text-xs font-medium">AI: {criterion.status}</p>
                        {criterion.errorExplanation && (
                          <p className="text-[10px] text-red-500 mt-1">{criterion.errorExplanation}</p>
                        )}
                      </TooltipContent>
                    </Tooltip>
                  </div>

                  {/* Evaluator Review — always show all 3 buttons */}
                  <div className="flex items-center justify-center gap-1">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          onClick={() => handleEvaluatorAgree(criterion.field)}
                          className={`px-2 py-1 rounded text-[10px] font-medium transition-all border ${
                            decision === "agree"
                              ? "bg-green-600 text-white border-green-600 ring-2 ring-green-300 ring-offset-1"
                              : "bg-white text-gray-500 border-gray-200 hover:border-green-400 hover:text-green-700 hover:bg-green-50"
                          }`}
                          aria-label={`Approve ${criterion.field}`}
                          aria-pressed={decision === "agree"}
                        >
                          <CheckCircle2 className="h-3 w-3 inline mr-0.5" />
                          Approve
                        </button>
                      </TooltipTrigger>
                      <TooltipContent>Approve this criterion</TooltipContent>
                    </Tooltip>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          onClick={() => handleEvaluatorOverride(criterion.field)}
                          className={`px-2 py-1 rounded text-[10px] font-medium transition-all border ${
                            decision === "override"
                              ? "bg-orange-500 text-white border-orange-500 ring-2 ring-orange-300 ring-offset-1"
                              : "bg-white text-gray-500 border-gray-200 hover:border-orange-400 hover:text-orange-700 hover:bg-orange-50"
                          }`}
                          aria-label={`Override ${criterion.field}`}
                          aria-pressed={decision === "override"}
                        >
                          <ShieldAlert className="h-3 w-3 inline mr-0.5" />
                          Override
                        </button>
                      </TooltipTrigger>
                      <TooltipContent>Override AI decision</TooltipContent>
                    </Tooltip>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          onClick={() => handleEvaluatorEmail(criterion.field)}
                          className={`px-2 py-1 rounded text-[10px] font-medium transition-all border ${
                            decision === "email"
                              ? "bg-blue-600 text-white border-blue-600 ring-2 ring-blue-300 ring-offset-1"
                              : "bg-white text-gray-500 border-gray-200 hover:border-blue-400 hover:text-blue-700 hover:bg-blue-50"
                          }`}
                          aria-label={`Email counselor about ${criterion.field}`}
                          aria-pressed={decision === "email"}
                        >
                          <Mail className="h-3 w-3 inline mr-0.5" />
                          Email
                        </button>
                      </TooltipTrigger>
                      <TooltipContent>Email Counselor for review</TooltipContent>
                    </Tooltip>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Overall Status Row */}
          <div className="grid grid-cols-[auto_1fr_100px_180px] gap-2 items-center pt-3 mt-2 border-t">
            <span className="w-5"></span>
            <span className="text-xs font-semibold uppercase text-muted-foreground">Overall</span>
            <div className="flex justify-center">
              <Badge
                variant={
                  comparison.overallDecision === "approved" ? "success"
                    : comparison.overallDecision === "denied" ? "error"
                    : "warning"
                }
                className="text-[9px]"
              >
                {comparison.overallDecision === "approved" ? "AI: Pass"
                  : comparison.overallDecision === "denied" ? "AI: Fail"
                  : "AI: Review"}
              </Badge>
            </div>
            <div className="flex justify-center">
              <Badge
                variant={
                  Object.keys(evaluatorDecisions).length === comparison.evaluationCriteria.length
                    ? Object.values(evaluatorDecisions).every((d) => d === "agree")
                      ? "success"
                      : Object.values(evaluatorDecisions).some((d) => d === null)
                      ? "secondary"
                      : "warning"
                    : "secondary"
                }
                className="text-[9px]"
              >
                {Object.keys(evaluatorDecisions).length === comparison.evaluationCriteria.length &&
                 Object.values(evaluatorDecisions).every((d) => d !== null)
                  ? Object.values(evaluatorDecisions).every((d) => d === "agree")
                    ? "Eval: Pass"
                    : "Eval: Review"
                  : "Eval: Pending"}
              </Badge>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Mobile fallback */}
      <div className="lg:hidden">
        <Card>
          <CardContent className="py-4">
            <h4 className="text-sm font-medium mb-3 text-center">Evaluation Criteria</h4>
            <div className="space-y-2">
              {comparison.evaluationCriteria.map((criterion, index) => (
                <div key={criterion.field} className="flex items-center justify-between text-sm">
                  <span>{CRITERIA_MARKERS[index]} {criterion.field}</span>
                  {criterion.status === "approved" ? (
                    <CheckCircle2 className="h-4 w-4 text-green-600" />
                  ) : (
                    <XCircle className="h-4 w-4 text-red-500" />
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Email Counselor Dialog */}
      <Dialog open={emailDialogOpen} onOpenChange={setEmailDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Alert Counselor for Course Description Review</DialogTitle>
            <DialogDescription>
              Send an alert to the student's counselor for a more detailed review
              of the course description to verify articulation compliance.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <label htmlFor="counselor-email" className="text-sm font-medium">
                Counselor Email
              </label>
              <Input
                id="counselor-email"
                type="email"
                placeholder="counselor@goldenwestcollege.edu"
                value={counselorEmail}
                onChange={(e) => setCounselorEmail(e.target.value)}
                className="mt-1"
              />
            </div>
            <div className="rounded-md bg-muted p-3 text-xs">
              <p className="font-medium mb-1">Message Preview:</p>
              <p className="text-muted-foreground">
                Course description review requested for{" "}
                <strong>{comparison.transferCourse.courseNumber} ({comparison.transferCourse.title})</strong>{" "}
                → <strong>{comparison.equivalentCourse.courseNumber} ({comparison.equivalentCourse.title})</strong>.
                Please verify articulation standards are met.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEmailDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={sendCounselorEmail}
              disabled={!counselorEmail || emailSent}
              className="bg-blue-600 hover:bg-blue-700 text-white"
            >
              {emailSent ? (
                <>
                  <CheckCircle2 className="h-4 w-4 mr-1" />
                  Sent!
                </>
              ) : (
                <>
                  <Mail className="h-4 w-4 mr-1" />
                  Send Alert
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Course Description Comparison Dialog */}
      <CourseDescriptionDialog
        open={descriptionDialogOpen}
        onOpenChange={setDescriptionDialogOpen}
        comparison={comparison}
      />
    </div>
  );
}

import { useState } from "react";
import { Check, X, ShieldAlert, Send } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
} from "@/components/ui/dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export type FinalDecision = "approved" | "denied" | "override" | null;

interface FinalDecisionCardProps {
  decision: FinalDecision;
  onDecisionChange: (decision: FinalDecision) => void;
  onSubmit: () => void;
  isSubmitted: boolean;
  courseNumber: string;
}

export function FinalDecisionCard({
  decision,
  onDecisionChange,
  onSubmit,
  isSubmitted,
  courseNumber,
}: FinalDecisionCardProps) {
  const [confirmDialogOpen, setConfirmDialogOpen] = useState(false);

  const handleSubmit = () => {
    setConfirmDialogOpen(false);
    onSubmit();
  };

  const getStatusText = () => {
    if (isSubmitted) return "Submitted";
    if (!decision) return "No decision selected";
    return "Ready to Submit";
  };

  const getDecisionLabel = () => {
    if (!decision) return "—";
    if (decision === "approved") return "Approved";
    if (decision === "denied") return "Denied";
    return "Override";
  };

  return (
    <>
      <Card className={isSubmitted ? "border-green-300 bg-green-50/30" : ""}>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Final Evaluation Decision</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Decision Buttons */}
          <div className="flex gap-2">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant={decision === "approved" ? "success" : "outline"}
                  size="sm"
                  className={`flex-1 ${
                    decision === "approved"
                      ? "ring-2 ring-green-400 ring-offset-1 font-bold"
                      : ""
                  }`}
                  onClick={() => onDecisionChange("approved")}
                  disabled={isSubmitted}
                >
                  {decision === "approved" && <Check className="h-4 w-4 mr-1" />}
                  Accept
                </Button>
              </TooltipTrigger>
              <TooltipContent>Approve this course transfer</TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant={decision === "denied" ? "error" : "outline"}
                  size="sm"
                  className={`flex-1 ${
                    decision === "denied"
                      ? "ring-2 ring-red-400 ring-offset-1 font-bold"
                      : ""
                  }`}
                  onClick={() => onDecisionChange("denied")}
                  disabled={isSubmitted}
                >
                  {decision === "denied" && <X className="h-4 w-4 mr-1" />}
                  Deny
                </Button>
              </TooltipTrigger>
              <TooltipContent>Deny this course transfer</TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant={decision === "override" ? "warning" : "outline"}
                  size="sm"
                  className={`flex-1 ${
                    decision === "override"
                      ? "ring-2 ring-orange-400 ring-offset-1 font-bold"
                      : ""
                  }`}
                  onClick={() => onDecisionChange("override")}
                  disabled={isSubmitted}
                >
                  {decision === "override" && <ShieldAlert className="h-4 w-4 mr-1" />}
                  Override
                </Button>
              </TooltipTrigger>
              <TooltipContent>Override the AI evaluation</TooltipContent>
            </Tooltip>
          </div>

          <Separator />

          {/* Decision Summary */}
          <div className="space-y-2 text-sm">
            <div className="flex justify-between items-center">
              <span className="text-muted-foreground">Decision:</span>
              <Badge
                variant={
                  decision === "approved"
                    ? "success"
                    : decision === "denied"
                    ? "error"
                    : decision === "override"
                    ? "warning"
                    : "secondary"
                }
              >
                {getDecisionLabel()}
              </Badge>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-muted-foreground">Status:</span>
              <span className={`font-medium text-xs ${
                isSubmitted ? "text-green-700" : decision ? "text-blue-700" : "text-gray-500"
              }`}>
                {getStatusText()}
              </span>
            </div>
            {isSubmitted && (
              <div className="flex justify-between items-center">
                <span className="text-muted-foreground">Course:</span>
                <span className="font-medium text-xs">{courseNumber}</span>
              </div>
            )}
          </div>

          <Separator />

          {/* Submit Button */}
          <Button
            className="w-full"
            disabled={!decision || isSubmitted}
            onClick={() => setConfirmDialogOpen(true)}
          >
            <Send className="h-4 w-4 mr-2" />
            {isSubmitted ? "Decision Submitted" : "Submit Decision"}
          </Button>
        </CardContent>
      </Card>

      {/* Confirmation Dialog */}
      <Dialog open={confirmDialogOpen} onOpenChange={setConfirmDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm Submission</DialogTitle>
            <DialogDescription>
              Are you sure you want to submit this evaluation? Once submitted, this decision
              will appear in the evaluation report.
            </DialogDescription>
          </DialogHeader>
          <div className="py-3">
            <div className="rounded-md border p-3 bg-muted/50 space-y-1 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Course:</span>
                <span className="font-medium">{courseNumber}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Decision:</span>
                <Badge
                  variant={
                    decision === "approved" ? "success"
                      : decision === "denied" ? "error"
                      : "warning"
                  }
                >
                  {getDecisionLabel()}
                </Badge>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSubmit}>
              <Send className="h-4 w-4 mr-1" />
              Submit
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

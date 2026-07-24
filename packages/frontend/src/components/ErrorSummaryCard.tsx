import { AlertTriangle, BookOpen, Bot, UserCheck } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { CourseComparison } from "@/types/course";
import { EvaluatorDecision } from "./CourseComparisonWorkspace";

const CRITERIA_MARKERS = ["①", "②", "③", "④"];

interface ErrorSummaryCardProps {
  comparisons: CourseComparison[];
  currentComparison: CourseComparison;
  evaluatorDecisions: Record<string, EvaluatorDecision>;
}

export function ErrorSummaryCard({
  comparisons,
  currentComparison,
  evaluatorDecisions,
}: ErrorSummaryCardProps) {
  const totalErrors = comparisons.filter((c) => c.errorExplanation).length;

  return (
    <Card className="border-l-4 border-l-blue-400">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertTriangle className={`h-4 w-4 ${totalErrors > 0 ? "text-red-500" : "text-green-600"}`} />
            AI Error Summary
          </div>
          <Badge variant={totalErrors > 0 ? "error" : "success"}>
            Errors: {totalErrors}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Per-criteria breakdown with markers */}
        <div className="space-y-1">
          <p className="text-[10px] uppercase font-semibold text-muted-foreground tracking-wide mb-2">
            Current Course — Criteria Decisions
          </p>

          {currentComparison.evaluationCriteria.map((criterion, index) => {
            const evalDecision = evaluatorDecisions[criterion.field];
            return (
              <div key={criterion.field} className="rounded-md border p-2 space-y-1.5">
                {/* Marker + Field Name */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <span className="text-sm font-bold text-blue-600">
                      {CRITERIA_MARKERS[index]}
                    </span>
                    <span className="text-xs font-medium">{criterion.field}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Indicator
                      icon={<Bot className="h-3 w-3" />}
                      status={criterion.status === "approved" ? "pass" : criterion.status === "warning" ? "warning" : "fail"}
                      label="AI"
                    />
                    <Indicator
                      icon={<UserCheck className="h-3 w-3" />}
                      status={
                        evalDecision === "agree"
                          ? "pass"
                          : evalDecision === "override"
                          ? "override"
                          : "pending"
                      }
                      label="Eval"
                    />
                  </div>
                </div>

                {/* Policy reference */}
                {criterion.policyReference && (
                  <div className="flex items-start gap-1 pl-5">
                    <BookOpen className="h-3 w-3 text-muted-foreground mt-0.5 shrink-0" />
                    <p className="text-[10px] text-muted-foreground leading-tight">
                      {criterion.policyReference}
                    </p>
                  </div>
                )}

                {/* Error explanation if present */}
                {criterion.errorExplanation && (
                  <div className="pl-5">
                    <p className="text-[10px] text-red-600 leading-tight">
                      ⚠ {criterion.errorExplanation}
                    </p>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <Separator />

        {/* Overall error details */}
        {currentComparison.errorExplanation && (
          <Accordion type="single" collapsible className="w-full">
            <AccordionItem value="error-detail">
              <AccordionTrigger className="text-xs py-2">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="h-3 w-3 text-red-500" />
                  <span className="text-red-700">Full Error Explanation</span>
                </div>
              </AccordionTrigger>
              <AccordionContent>
                <Alert variant="destructive" className="mt-1">
                  <AlertTriangle className="h-3 w-3" />
                  <AlertTitle className="text-xs">AI Decision Rationale</AlertTitle>
                  <AlertDescription className="text-[10px]">
                    {currentComparison.errorExplanation}
                  </AlertDescription>
                </Alert>
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        )}
      </CardContent>
    </Card>
  );
}

function Indicator({
  icon,
  status,
  label,
}: {
  icon: React.ReactNode;
  status: "pass" | "fail" | "warning" | "override" | "pending";
  label: string;
}) {
  const colors = {
    pass: "bg-green-100 text-green-700 border-green-200",
    fail: "bg-red-100 text-red-700 border-red-200",
    warning: "bg-yellow-100 text-yellow-700 border-yellow-200",
    override: "bg-orange-100 text-orange-700 border-orange-200",
    pending: "bg-gray-100 text-gray-400 border-gray-200",
  };

  return (
    <div
      className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-medium border ${colors[status]}`}
    >
      {icon}
      <span>{label}</span>
    </div>
  );
}

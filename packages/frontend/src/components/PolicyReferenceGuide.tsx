import { BookOpen, ExternalLink } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

export function PolicyReferenceGuide() {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <BookOpen className="h-4 w-4 text-primary" />
          Policy Reference Guide
        </CardTitle>
      </CardHeader>
      <CardContent>
        <Accordion type="single" collapsible className="w-full">
          <AccordionItem value="credit-policy">
            <AccordionTrigger className="text-xs">
              Transfer Credit Policy
            </AccordionTrigger>
            <AccordionContent>
              <div className="text-xs space-y-2 text-muted-foreground">
                <p>
                  Credits are accepted from regionally accredited institutions.
                  A minimum grade of C (2.0) is required for course-to-course articulation.
                </p>
                <p>
                  Courses must have been completed within the last 5 years for STEM subjects
                  or 7 years for general education.
                </p>
              </div>
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value="description-match">
            <AccordionTrigger className="text-xs">
              Course Description Matching
            </AccordionTrigger>
            <AccordionContent>
              <div className="text-xs space-y-2 text-muted-foreground">
                <p>
                  Course descriptions must demonstrate at least 70% content overlap with the
                  equivalent course. Key topics, learning outcomes, and prerequisite knowledge
                  are weighted factors.
                </p>
                <p>
                  When in doubt, alert the student's counselor for a more detailed review.
                </p>
              </div>
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value="override-policy">
            <AccordionTrigger className="text-xs">
              Override Guidelines
            </AccordionTrigger>
            <AccordionContent>
              <div className="text-xs space-y-2 text-muted-foreground">
                <p>
                  Evaluators may override AI decisions when professional judgment determines
                  the automated assessment is incorrect. All overrides must include written
                  justification.
                </p>
                <p>
                  Overrides are reviewed by the department chair quarterly.
                </p>
              </div>
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value="grade-requirements">
            <AccordionTrigger className="text-xs">
              Grade Requirements
            </AccordionTrigger>
            <AccordionContent>
              <div className="text-xs space-y-2 text-muted-foreground">
                <p>
                  Minimum grade of C required for major courses. D grades may be accepted
                  for general electives only. Pass/No Pass grades are accepted only if the
                  institution confirms P equals C or better.
                </p>
              </div>
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value="c-id-system">
            <AccordionTrigger className="text-xs">
              C-ID Descriptor System
            </AccordionTrigger>
            <AccordionContent>
              <div className="text-xs space-y-2 text-muted-foreground">
                <p>
                  Courses with matching C-ID descriptors are automatically eligible
                  for articulation. Check ASSIST.org for the latest C-ID mappings.
                </p>
                <a
                  href="https://www.assist.org"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-blue-600 hover:underline"
                >
                  ASSIST.org <ExternalLink className="h-3 w-3" />
                </a>
              </div>
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </CardContent>
    </Card>
  );
}

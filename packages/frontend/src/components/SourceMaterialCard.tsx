import { FileText, BookOpen, Scale } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { SourceMaterial } from "@/types/course";

interface SourceMaterialCardProps {
  materials: SourceMaterial[];
}

const typeConfig = {
  catalog: {
    icon: BookOpen,
    label: "Catalogue",
    color: "text-blue-500",
  },
  transcript: {
    icon: FileText,
    label: "Transcript",
    color: "text-purple-500",
  },
  policy: {
    icon: Scale,
    label: "Policy Material",
    color: "text-amber-600",
  },
};

export function SourceMaterialCard({ materials }: SourceMaterialCardProps) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <FileText className="h-4 w-4 text-primary" />
          Source Material
        </CardTitle>
      </CardHeader>
      <CardContent>
        <Accordion type="multiple" className="w-full">
          {materials.map((material) => {
            const config = typeConfig[material.type];
            const Icon = config.icon;

            return (
              <AccordionItem key={material.id} value={material.id}>
                <AccordionTrigger className="text-sm">
                  <div className="flex items-center gap-2">
                    <Icon className={`h-4 w-4 ${config.color}`} />
                    <span>{config.label}</span>
                    <span className="text-xs text-muted-foreground ml-1">
                      — {material.title}
                    </span>
                  </div>
                </AccordionTrigger>
                <AccordionContent>
                  <ScrollArea className="h-[180px] rounded-md border p-3 bg-muted/30">
                    <pre className="text-xs whitespace-pre-wrap font-mono leading-relaxed">
                      {material.content}
                    </pre>
                  </ScrollArea>
                </AccordionContent>
              </AccordionItem>
            );
          })}
        </Accordion>
      </CardContent>
    </Card>
  );
}

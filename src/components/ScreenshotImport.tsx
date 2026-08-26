import { useMemo, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Check, ImageUp, Loader2, Plus, Trash2, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { extractScreenshotStage, type OcrProduct, type OcrResult, type OcrHourlyMetric } from "@/lib/ocr.functions";
import { extractHourlyWithContext } from "@/lib/ocr.hourly.functions";
import { useProductNorms, useProducts, useShiftAggregates } from "@/lib/data";
import { currentNorm, findProductByCode, type Product } from "@/lib/products";
import { SHIFTS, type Employee } from "@/lib/metrics";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useApprovalFields } from "@/lib/auth";

// ...rest of file unchanged

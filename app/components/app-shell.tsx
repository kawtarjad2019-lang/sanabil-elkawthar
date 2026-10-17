"use client";

import html2canvas from "html2canvas";
import jsPDF from "jspdf";
import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";

import { Icon } from "./icons";
import { LanguageProvider, useLanguage } from "./i18n";
import {
  buildInvoiceWhatsAppMessage,
  buildMultipleInvoiceWhatsAppMessage,
  buildMonthlyReminderMessage,
  buildPaymentConfirmationMessage,
  buildWhatsAppWebUrl,
  normalizeMoroccanMobileNumber,
  type WhatsAppMessageType,
} from "@/lib/whatsapp";
import { createClient } from "@/lib/supabase/client";
import {
  buildAcademicRevenueAnalytics,
  type RevenuePayment,
  type RevenueStudent,
} from "@/lib/payment-analytics";

export type Section =
  | "dashboard"
  | "students"
  | "teachers"
  | "classes"
  | "subjects"
  | "payments"
  | "attendance"
  | "expenses"
  | "reports"
  | "settings";

const items: [Section, string][] = [
  ["dashboard", "grid"],
  ["students", "users"],
  ["teachers", "user"],
  ["classes", "school"],
  ["subjects", "book"],
  ["payments", "card"],
  ["attendance", "calendar"],
  ["expenses", "wallet"],
  ["reports", "chart"],
  ["settings", "settings"],
];

const urls: Record<Section, string> = {
  dashboard: "/",
  students: "/students",
  teachers: "/teachers",
  classes: "/classes",
  subjects: "/subjects",
  payments: "/payments",
  attendance: "/attendance",
  expenses: "/expenses",
  reports: "/reports",
  settings: "/settings",
};

const rooms = ["قاعة 1", "قاعة 2", "قاعة 3", "قاعة 4"] as const;

const levels = [
  "المستوى الأول ابتدائي",
  "المستوى الثاني ابتدائي",
  "المستوى الثالث ابتدائي",
  "المستوى الرابع ابتدائي",
  "المستوى الخامس ابتدائي",
  "المستوى السادس ابتدائي",
  "المستوى الأول إعدادي",
  "المستوى الثاني إعدادي",
  "المستوى الثالث إعدادي",
] as const;

const levelToCode: Record<string, string> = {
  "المستوى الأول ابتدائي": "primary_1",
  "المستوى الثاني ابتدائي": "primary_2",
  "المستوى الثالث ابتدائي": "primary_3",
  "المستوى الرابع ابتدائي": "primary_4",
  "المستوى الخامس ابتدائي": "primary_5",
  "المستوى السادس ابتدائي": "primary_6",
  "المستوى الأول إعدادي": "middle_1",
  "المستوى الثاني إعدادي": "middle_2",
  "المستوى الثالث إعدادي": "middle_3",
};

const codeToLevel: Record<string, string> = Object.fromEntries(
  Object.entries(levelToCode).map(([label, code]) => [code, label])
);

function normalizeSearchText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function matchesStudentSearch(student: Student, query: string) {
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) return true;

  const searchableValues = [
    student.full_name,
    student.phone ?? "",
    codeToLevel[student.level_code] ?? student.level_code ?? "",
    ...(student.full_name.split(/\s+/).filter(Boolean)),
    ...(student.guardian_name ? [student.guardian_name] : []),
  ];

  return searchableValues.some((value) =>
    normalizeSearchText(value).includes(normalizedQuery)
  );
}

type Student = {
  id: string;
  full_name: string;
  teacher_id: string | null;
  teacher_compensation_type: "percentage" | "fixed_monthly_salary" | null;
  teacher_compensation_percentage: number | null;
  teacher_fixed_monthly_salary: number | null;
  room: string | null;
  monthly_fee: number | null;
  phone: string | null;
  email: string | null;
  level_code: string;
  registration_date: string;
  guardian_name: string | null;
  guardian_phone: string | null;
  notes: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

function WhatsAppRecipientDialog({
  studentName,
  savedPhone,
  close,
  onConfirm,
}: {
  studentName: string;
  savedPhone: string | null;
  close: () => void;
  onConfirm: (normalizedPhone: string) => void;
}) {
  const [recipientChoice, setRecipientChoice] = useState<"saved" | "custom" | "">("");
  const [customPhone, setCustomPhone] = useState("");
  const [validationError, setValidationError] = useState("");

  function confirmRecipient() {
    if (!recipientChoice) {
      setValidationError("يرجى اختيار رقم الهاتف قبل المتابعة.");
      return;
    }

    const rawPhone = recipientChoice === "saved" ? savedPhone : customPhone;
    const normalizedPhone = normalizeMoroccanMobileNumber(rawPhone);
    if (!normalizedPhone) {
      setValidationError(
        recipientChoice === "saved"
          ? savedPhone
            ? "رقم الهاتف المسجل غير صالح. اختر إدخال رقم آخر."
            : "لا يوجد رقم هاتف مسجل لهذا التلميذ. اختر إدخال رقم آخر."
          : "رقم الهاتف غير صالح. أدخل رقم محمول مغربي صحيحاً مثل 06XXXXXXXX أو +2126XXXXXXXX."
      );
      return;
    }

    setValidationError("");
    onConfirm(normalizedPhone);
  }

  return (
    <div
      className="modal-layer"
      dir="rtl"
      onMouseDown={(event) => {
        event.stopPropagation();
        if (event.target === event.currentTarget) close();
      }}
    >
      <div
        className="student-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="whatsapp-recipient-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="modal-head">
          <div>
            <h2 id="whatsapp-recipient-title">اختيار مستلم WhatsApp</h2>
            <p>{studentName}</p>
          </div>
          <button type="button" className="close" aria-label="إغلاق" onClick={close}>×</button>
        </div>
        <div style={{ display: "grid", gap: 12, padding: 18 }}>
          <label
            style={{
              display: "grid",
              gridTemplateColumns: "auto 1fr",
              alignItems: "start",
              gap: 10,
              padding: 12,
              border: "1px solid #e7ebef",
              borderRadius: 9,
            }}
          >
            <input
              type="radio"
              name="whatsapp-recipient-choice"
              value="saved"
              checked={recipientChoice === "saved"}
              onChange={() => {
                setRecipientChoice("saved");
                setValidationError("");
              }}
            />
            <span style={{ display: "grid", gap: 5 }}>
              <strong>استعمال رقم الهاتف المسجل</strong>
              <span dir="ltr" style={{ textAlign: "right" }}>{savedPhone?.trim() || "لا يوجد رقم مسجل"}</span>
            </span>
          </label>

          <label
            style={{
              display: "grid",
              gridTemplateColumns: "auto 1fr",
              alignItems: "start",
              gap: 10,
              padding: 12,
              border: "1px solid #e7ebef",
              borderRadius: 9,
            }}
          >
            <input
              type="radio"
              name="whatsapp-recipient-choice"
              value="custom"
              checked={recipientChoice === "custom"}
              onChange={() => {
                setRecipientChoice("custom");
                setValidationError("");
              }}
            />
            <span style={{ display: "grid", gap: 8 }}>
              <strong>إدخال رقم هاتف آخر</strong>
              <input
                type="tel"
                inputMode="tel"
                dir="ltr"
                autoComplete="tel"
                value={customPhone}
                onFocus={() => {
                  setRecipientChoice("custom");
                  setValidationError("");
                }}
                onChange={(event) => {
                  setCustomPhone(event.target.value);
                  setValidationError("");
                }}
                placeholder="06XXXXXXXX أو +2126XXXXXXXX"
                aria-label="رقم هاتف مستلم WhatsApp"
                style={{
                  width: "100%",
                  height: 39,
                  padding: "0 10px",
                  border: "1px solid #e3e9e6",
                  borderRadius: 7,
                }}
              />
            </span>
          </label>
          {validationError && <p className="form-error" role="alert" style={{ margin: 0 }}>{validationError}</p>}
        </div>
        <div className="modal-actions">
          <button type="button" className="secondary" onClick={close}>إلغاء</button>
          <button type="button" className="primary" onClick={confirmRecipient}>متابعة</button>
        </div>
      </div>
    </div>
  );
}

type Subject = {
  id: string;
  name: string;
  code: string | null;
  description: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

type ClassGroup = {
  id: string;
  name: string;
  level_code: string | null;
  room: string | null;
  is_active: boolean;
};

type AttendanceSessionRow = {
  id: string;
  session_date: string;
  class_id: string;
  subject_id: string;
  teacher_id: string;
  room: string;
  start_time: string;
  end_time: string;
};

type ClassSchedule = {
  id: string;
  class_id: string;
  subject_id: string;
  teacher_id: string;
  room: string;
  day_of_week: number;
  start_time: string;
  end_time: string;
  is_active: boolean;
};

type Teacher = {
  id: string;
  full_name: string;
  phone: string | null;
  email: string | null;
  specialty: string | null;
  monthly_salary: number | null;
  default_compensation_type: "percentage" | "fixed_monthly_salary";
  default_compensation_percentage: number;
  notes: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

type SupabaseErrorShape = {
  code?: string;
  message?: string;
  details?: string;
  hint?: string;
};

function isCompensationSchemaError(error: SupabaseErrorShape | null) {
  if (!error) return false;
  const text = `${error.code ?? ""} ${error.message ?? ""} ${error.details ?? ""}`.toLowerCase();
  return [
    "teacher_id",
    "teacher_compensation",
    "teacher_fixed_monthly_salary",
    "compensation_type_snapshot",
  ].some((field) => text.includes(field)) || text.includes("pgrst204") || text.includes("42703");
}

const SCHOOL_YEAR_MONTH_ORDER = [8, 9, 10, 11, 0, 1, 2, 3, 4, 5, 6, 7] as const;

function getSchoolYearStartYear(date: Date = new Date()) {
  return date.getMonth() >= 8 ? date.getFullYear() : date.getFullYear() - 1;
}

function getCurrentSchoolYearMonthNumber(date: Date = new Date()) {
  const monthIndex = SCHOOL_YEAR_MONTH_ORDER.indexOf(date.getMonth() as (typeof SCHOOL_YEAR_MONTH_ORDER)[number]);
  return monthIndex >= 0 ? monthIndex + 1 : 1;
}

function getSchoolYearRange(date: Date = new Date()) {
  const startYear = getSchoolYearStartYear(date);
  const start = new Date(Date.UTC(startYear, 8, 1, 0, 0, 0, 0));
  const end = new Date(Date.UTC(startYear + 1, 7, 31, 23, 59, 59, 999));
  return { start, end, startYear };
}

function getSchoolYearMonths(date: Date = new Date()) {
  const startYear = getSchoolYearStartYear(date);
  return Array.from({ length: 12 }, (_, index) => {
    const monthDate = new Date(Date.UTC(startYear, 8 + index, 1));
    return {
      key: `${monthDate.getUTCFullYear()}-${String(monthDate.getUTCMonth() + 1).padStart(2, "0")}`,
      monthNumber: monthDate.getUTCMonth() + 1,
      year: monthDate.getUTCFullYear(),
    };
  });
}

function paymentIsInSchoolYear(
  payment: { payment_month?: string | null; payment_date?: string | null },
  referenceDate: Date = new Date()
) {
  const { start, end } = getSchoolYearRange(referenceDate);
  const value = payment.payment_month ?? payment.payment_date ?? "";

  if (!value) {
    return false;
  }

  const paymentDate = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(paymentDate.getTime())) {
    return false;
  }

  return paymentDate >= start && paymentDate <= end;
}

function getStudentSchoolYearPaidTotal(
  studentId: string,
  payments: Array<{ student_id: string; payment_month?: string | null; payment_date?: string | null; amount_paid?: number | string | null }>,
  referenceDate: Date = new Date()
) {
  return payments
    .filter(
      (payment) =>
        payment.student_id === studentId &&
        paymentIsInSchoolYear(payment, referenceDate)
    )
    .reduce((sum, payment) => sum + Number(payment.amount_paid ?? 0), 0);
}

function getInitials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);

  if (parts.length === 0) {
    return "?";
  }

  if (parts.length === 1) {
    return parts[0].slice(0, 2).toUpperCase();
  }

  return `${parts[0][0] ?? ""}${parts[1][0] ?? ""}`.toUpperCase();
}

function getNextDueDate(dateString: string) {
  const date = new Date(`${dateString}T00:00:00Z`);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();
  const day = date.getUTCDate();

  const nextMonth = month + 1;

  const nextMonthLastDay = new Date(
    Date.UTC(year, nextMonth + 1, 0)
  ).getUTCDate();

  const safeDay = Math.min(day, nextMonthLastDay);

  return new Date(Date.UTC(year, nextMonth, safeDay));
}

function formatDate(dateString: string, lang: "ar" | "fr") {
  const date = new Date(`${dateString}T00:00:00Z`);

  if (Number.isNaN(date.getTime())) {
    return "—";
  }

  return date.toLocaleDateString(
    lang === "ar" ? "ar-MA" : "fr-FR",
    {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      timeZone: "UTC",
    }
  );
}

function Avatar({
  name,
  tone = "green",
}: {
  name: string;
  tone?: string;
}) {
  return <span className={`avatar ${tone}`}>{name}</span>;
}

function Side({
  page,
  close,
}: {
  page: Section;
  close: () => void;
}) {
  const { t } = useLanguage();

  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-mark">
          <Image
            src="/images/logo.png"
            alt={t("brand")}
            width={43}
            height={43}
          />
        </div>

        <div>
          <strong>{t("brand")}</strong>
          <small>{t("subtitle")}</small>
        </div>
      </div>

      <nav>
        {items.map(([key, icon]) => (
          <Link
            key={key}
            href={urls[key]}
            onClick={close}
            className={`nav-link ${page === key ? "active" : ""}`}
          >
            <Icon name={icon} />
            {t(key)}
          </Link>
        ))}
      </nav>

      <div className="sidebar-bottom">
        <div className="support">
          <b>?</b>

          <div>
            <strong>{t("help")}</strong>
            <small>{t("contact")}</small>
          </div>
        </div>

        <button className="logout">
          <Icon name="logout" />
          {t("logout")}
        </button>
      </div>
    </aside>
  );
}

function Dashboard() {
  const { t } = useLanguage();
  const [studentCount, setStudentCount] = useState(0);
  const [income, setIncome] = useState(0);
  const [expectedIncome, setExpectedIncome] = useState(0);
  const [expenses, setExpenses] = useState(0);
  const [teacherShares, setTeacherShares] = useState(0);
  const [fixedTeacherSalaries, setFixedTeacherSalaries] = useState(0);
  const [levelCounts, setLevelCounts] = useState<Record<string, number>>({});
  const [revenuePayments, setRevenuePayments] = useState<RevenuePayment[]>([]);
  const [revenueStudents, setRevenueStudents] = useState<RevenueStudent[]>([]);
  const [revenueAnalyticsLoading, setRevenueAnalyticsLoading] = useState(true);
  const [revenueAnalyticsError, setRevenueAnalyticsError] = useState("");
  const [selectedAcademicYearStartYear, setSelectedAcademicYearStartYear] = useState(
    () => getSchoolYearStartYear()
  );
  const [attendanceDate, setAttendanceDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [attendanceStats, setAttendanceStats] = useState<Record<AttendanceStatus, number>>({ present: 0, absent: 0, late: 0, excused: 0 });
  const [loadingStats, setLoadingStats] = useState(true);

  useEffect(() => {
    async function loadDashboardStats() {
      setLoadingStats(true);
      setRevenueAnalyticsLoading(true);
      setRevenueAnalyticsError("");
      const supabase = createClient();

      const now = new Date();
      const start = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
      const next = new Date(now.getFullYear(), now.getMonth() + 1, 1);
      const nextStart = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}-01`;

      const [studentsResult, paymentsResult, expensesResult, salariesResult, attendanceResult] = await Promise.all([
        supabase.from("students").select("id, monthly_fee, level_code").eq("is_active", true),
        supabase
          .from("payments")
          .select("amount_paid, teacher_share")
          .is("deleted_at", null),
        supabase
          .from("expenses")
          .select("amount")
          .gte("expense_date", start)
          .lt("expense_date", nextStart),
        supabase
          .from("teacher_salary_payments")
          .select("paid_amount")
          .gte("salary_month", start)
          .lt("salary_month", nextStart),
        supabase
          .from("attendance_session_records")
          .select("status, attendance_sessions!inner(session_date)")
          .eq("attendance_sessions.session_date", attendanceDate),
      ]);

      const studentsData = studentsResult.data ?? [];
      setStudentCount(studentsData.length);
      const monthsDue = getCurrentSchoolYearMonthNumber(now);
      setExpectedIncome(
        studentsData.reduce(
          (sum, student) => sum + Number(student.monthly_fee ?? 0) * monthsDue,
          0
        )
      );
      setLevelCounts(
        studentsData.reduce<Record<string, number>>((counts, student) => {
          const levelCode = String(student.level_code ?? "");
          counts[levelCode] = (counts[levelCode] ?? 0) + 1;
          return counts;
        }, {})
      );

      if (!paymentsResult.error) {
        const paymentRows = paymentsResult.data ?? [];
        const totalActualIncome = paymentRows.reduce(
          (sum, payment) => sum + Number(payment.amount_paid ?? 0),
          0
        );
        setIncome(totalActualIncome);
        setTeacherShares(
          paymentRows.reduce(
            (sum, payment) => sum + Number(payment.teacher_share ?? 0),
            0
          )
        );
      }

      if (!salariesResult.error) {
        setFixedTeacherSalaries(
          (salariesResult.data ?? []).reduce(
            (sum, salary) => sum + Number(salary.paid_amount ?? 0),
            0
          )
        );
      }

      if (!attendanceResult.error) {
        const nextAttendance = { present: 0, absent: 0, late: 0, excused: 0 } as Record<AttendanceStatus, number>;
        (attendanceResult.data ?? []).forEach((record) => {
          const status = String(record.status) as AttendanceStatus;
          if (status in nextAttendance) nextAttendance[status] += 1;
        });
        setAttendanceStats(nextAttendance);
      }

      if (!expensesResult.error) {
        setExpenses(
          (expensesResult.data ?? []).reduce(
            (sum, expense) => sum + Number(expense.amount ?? 0),
            0
          )
        );
      }

      setLoadingStats(false);
    }

    loadDashboardStats();
  }, [attendanceDate]);

  useEffect(() => {
    let cancelled = false;

    async function loadAcademicRevenue() {
      setRevenueAnalyticsLoading(true);
      setRevenueAnalyticsError("");
      const supabase = createClient();
      const start = `${selectedAcademicYearStartYear}-09-01`;
      const end = `${selectedAcademicYearStartYear + 1}-07-01`;

      try {
        async function loadPages<T>(
          queryPage: (from: number, to: number) => PromiseLike<{
            data: T[] | null;
            error: { message: string } | null;
          }>
        ) {
          const rows: T[] = [];
          const pageSize = 1000;
          for (let offset = 0; ; offset += pageSize) {
            const { data, error } = await queryPage(offset, offset + pageSize - 1);
            if (error) throw error;
            const page = data ?? [];
            rows.push(...page);
            if (page.length < pageSize) return rows;
          }
        }

        const [payments, students] = await Promise.all([
          loadPages<{
            id: string;
            student_id: string;
            payment_month: string;
            amount_paid: number | string | null;
          }>(async (from, to) =>
            await supabase
              .from("payments")
              .select("id, student_id, payment_month, amount_paid")
              .is("deleted_at", null)
              .gte("payment_month", start)
              .lt("payment_month", end)
              .order("id", { ascending: true })
              .range(from, to)
          ),
          loadPages<{
            id: string;
            level_code: string | null;
          }>(async (from, to) =>
            await supabase
              .from("students")
              .select("id, level_code")
              .order("id", { ascending: true })
              .range(from, to)
          ),
        ]);

        if (cancelled) return;
        setRevenuePayments(payments.map((payment) => ({
          id: String(payment.id),
          student_id: String(payment.student_id),
          payment_month: String(payment.payment_month ?? ""),
          amount_paid: Number(payment.amount_paid ?? 0),
        })));
        setRevenueStudents(students.map((student) => ({
          id: String(student.id),
          level_code: student.level_code == null ? null : String(student.level_code),
        })));
      } catch (error) {
        console.error("Dashboard academic revenue query failed", error);
        if (!cancelled) {
          setRevenuePayments([]);
          setRevenueStudents([]);
          setRevenueAnalyticsError("تعذر تحميل الأداءات أو مستويات التلاميذ لتحليل المداخيل.");
        }
      } finally {
        if (!cancelled) setRevenueAnalyticsLoading(false);
      }
    }

    void loadAcademicRevenue();
    return () => {
      cancelled = true;
    };
  }, [selectedAcademicYearStartYear]);

  const totalTeacherCosts = teacherShares + fixedTeacherSalaries;
  const profit = income - totalTeacherCosts - expenses;
  const formatMoney = (value: number) =>
    `${value.toLocaleString("fr-FR", { maximumFractionDigits: 2 })} د.م`;
  const revenueAnalytics = useMemo(
    () => buildAcademicRevenueAnalytics(
      revenuePayments,
      revenueStudents,
      selectedAcademicYearStartYear
    ),
    [revenuePayments, revenueStudents, selectedAcademicYearStartYear]
  );
  const academicYearOptions = useMemo(
    () => {
      const lastYear = new Date().getFullYear() + 1;
      const availableYears = Array.from(
        { length: lastYear - 2000 + 1 },
        (_, index) => lastYear - index
      );
      return availableYears.includes(selectedAcademicYearStartYear)
        ? availableYears
        : [selectedAcademicYearStartYear, ...availableYears];
    },
    [selectedAcademicYearStartYear]
  );
  const maximumMonthlyRevenue = Math.max(
    0,
    ...revenueAnalytics.months.map((month) => month.amount)
  );
  const maximumLevelRevenue = Math.max(
    0,
    ...revenueAnalytics.levelTotals.map((level) => level.amount)
  );
  const levelDisplayOrder = [
    ...levels.map((level) => levelToCode[level]),
    ...revenueAnalytics.levelCodes.filter(
      (levelCode) => !levels.some((level) => levelToCode[level] === levelCode)
    ),
  ];
  const revenueLevels = levelDisplayOrder
    .filter((levelCode) => revenueAnalytics.levelCodes.includes(levelCode))
    .map((levelCode) => ({
      levelCode,
      label: codeToLevel[levelCode] ?? levelCode,
      amount: revenueAnalytics.levelTotals.find((level) => level.levelCode === levelCode)?.amount ?? 0,
    }));
  const formatRevenueAmount = (amount: number) =>
    `${amount.toLocaleString("fr-FR", { maximumFractionDigits: 2 })} DH`;

  const stats = [
    ["users", loadingStats ? "..." : String(studentCount), "studentCount", "mint"],
    ["wallet", loadingStats ? "..." : formatMoney(expectedIncome), "expectedIncome", "sky"],
    ["wallet", loadingStats ? "..." : formatMoney(income), "income", "blue"],
    ["wallet", loadingStats ? "..." : formatMoney(expenses), "expensesTotal", "peach"],
    ["wallet", loadingStats ? "..." : formatMoney(totalTeacherCosts), "teacherCosts", "orange"],
    ["wallet", loadingStats ? "..." : formatMoney(profit), "netProfit", "lavender"],
  ] as const;

  return (
    <>
      <section className="welcome">
        <div>
          <p>{new Date().toLocaleDateString("fr-FR")}</p>
          <h1>{t("welcome")}</h1>
          <h2>{t("overview")}</h2>
        </div>

        <button className="primary">
          <Icon name="plus" size={18} />
          {t("addStudent")}
        </button>
      </section>

      <section className="stats">
        {stats.map((s) => (
          <article className="stat-card" key={s[2]}>
            <div className={`stat-icon ${s[3]}`}>
              <Icon name={s[0]} />
            </div>

            <div>
              <span>{t(s[2])}</span>
              <strong>{s[1]}</strong>
              <small className="up">حسب الأثمنة الشهرية المسجلة</small>
            </div>
          </article>
        ))}
      </section>

      <section className="dashboard-finance">
        <div className="panel-head">
          <div>
            <h2>تفصيل الوضعية المالية</h2>
            <p>إضافة توضيحية لتكلفة الأساتذة والربح الحقيقي لهذا الشهر.</p>
          </div>
        </div>
        <div className="stats">
          {([
            ["wallet", loadingStats ? "..." : formatMoney(income), "collectedIncome", "blue"],
            ["wallet", loadingStats ? "..." : formatMoney(teacherShares), "percentageTeacherShares", "orange"],
            ["wallet", loadingStats ? "..." : formatMoney(fixedTeacherSalaries), "fixedTeacherSalaries", "peach"],
            ["wallet", loadingStats ? "..." : formatMoney(totalTeacherCosts), "totalTeacherCosts", "lavender"],
            ["wallet", loadingStats ? "..." : formatMoney(expenses), "otherExpenses", "sky"],
            ["wallet", loadingStats ? "..." : formatMoney(profit), "realNetProfit", "mint"],
          ] as const).map((stat) => (
            <article className="stat-card" key={stat[2]}>
              <div className={`stat-icon ${stat[3]}`}><Icon name={stat[0]} /></div>
              <div><span>{t(stat[2])}</span><strong>{stat[1]}</strong></div>
            </article>
          ))}
        </div>
      </section>

      <section className="dashboard-finance" dir="rtl">
        <div className="panel-head" style={{ alignItems: "center", flexWrap: "wrap", gap: 12 }}>
          <div>
            <h2>تحليل المداخيل حسب السنة الدراسية</h2>
            <p>المبالغ المسجلة حسب الشهر الدراسي المؤدى عنه، من شتنبر إلى يونيو.</p>
          </div>
          <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
            السنة الدراسية
            <select
              value={selectedAcademicYearStartYear}
              onChange={(event) => setSelectedAcademicYearStartYear(Number(event.target.value))}
              aria-label="اختر السنة الدراسية"
            >
              {academicYearOptions.map((startYear) => (
                <option key={startYear} value={startYear}>
                  {startYear}–{startYear + 1}
                </option>
              ))}
            </select>
          </label>
        </div>

        {revenueAnalyticsLoading ? (
          <div className="empty" style={{ textAlign: "center" }}>
            <h2>جاري تحميل تحليل المداخيل...</h2>
          </div>
        ) : revenueAnalyticsError ? (
          <p className="form-error" role="alert">{revenueAnalyticsError}</p>
        ) : (
          <>
            <div
              aria-label="المداخيل الشهرية بالدرهم"
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(10, minmax(72px, 1fr))",
                gap: 10,
                alignItems: "end",
                overflowX: "auto",
                padding: "18px 8px 8px",
              }}
            >
              {revenueAnalytics.months.map((month) => (
                <div
                  key={month.key}
                  style={{
                    minWidth: 72,
                    display: "grid",
                    gridTemplateRows: "auto 170px auto",
                    gap: 8,
                    alignItems: "end",
                    textAlign: "center",
                  }}
                >
                  <strong style={{ fontSize: 11 }}>
                    {formatRevenueAmount(month.amount)}
                  </strong>
                  <div
                    style={{
                      height: 170,
                      display: "flex",
                      alignItems: "end",
                      justifyContent: "center",
                      borderBottom: "1px solid #dfe8e4",
                      background: "repeating-linear-gradient(to top, transparent 0, transparent 41px, #edf2ef 42px)",
                    }}
                  >
                    <div
                      title={`${month.label} ${month.year}: ${formatRevenueAmount(month.amount)}`}
                      style={{
                        width: "58%",
                        height: maximumMonthlyRevenue > 0
                          ? `${Math.max((month.amount / maximumMonthlyRevenue) * 160, month.amount > 0 ? 4 : 0)}px`
                          : 0,
                        background: "#16806b",
                        borderRadius: "6px 6px 0 0",
                        transition: "height 180ms ease",
                      }}
                    />
                  </div>
                  <span style={{ fontSize: 12, fontWeight: 700 }}>{month.label}</span>
                </div>
              ))}
            </div>

            {revenueAnalytics.months.every((month) => month.paymentCount === 0) && (
              <p className="empty" style={{ textAlign: "center", margin: "0 12px 14px" }}>
                لا توجد أداءات مسجلة لهذه السنة الدراسية.
              </p>
            )}

            <div style={{ marginTop: 18, borderTop: "1px solid #edf1ef", paddingTop: 18 }}>
              <div style={{ marginBottom: 12 }}>
                <h3 style={{ margin: "0 0 5px" }}>المداخيل حسب المستوى الدراسي</h3>
                <p style={{ margin: 0, color: "#83908d", fontSize: 12 }}>
                  المبالغ مبنية على الأداءات المسجلة للتلاميذ المرتبطين بكل مستوى.
                </p>
              </div>
              {revenueLevels.length === 0 ? (
                <p className="empty" style={{ textAlign: "center" }}>
                  لا توجد مستويات دراسية مسجلة لعرضها.
                </p>
              ) : (
                <div style={{ display: "grid", gap: 10 }}>
                  {revenueLevels.map((level) => (
                    <div
                      key={level.levelCode}
                      style={{
                        display: "grid",
                        gridTemplateColumns: "minmax(110px, 1fr) minmax(110px, 3fr) minmax(100px, 1fr)",
                        alignItems: "center",
                        gap: 10,
                      }}
                    >
                      <strong style={{ fontSize: 12 }}>{level.label}</strong>
                      <div style={{ height: 12, background: "#edf3f0", borderRadius: 8, overflow: "hidden" }}>
                        <div
                          style={{
                            height: "100%",
                            width: maximumLevelRevenue > 0
                              ? `${Math.max((level.amount / maximumLevelRevenue) * 100, level.amount > 0 ? 1 : 0)}%`
                              : "0%",
                            background: "#4aa88e",
                            borderRadius: 8,
                          }}
                        />
                      </div>
                      <span style={{ textAlign: "left", fontSize: 12 }}>
                        {formatRevenueAmount(level.amount)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
              {revenueAnalytics.unassignedLevelPaymentCount > 0 && (
                <p style={{ margin: "12px 0 0", color: "#83908d", fontSize: 11 }}>
                  لم يمكن تصنيف {revenueAnalytics.unassignedLevelPaymentCount} أداءً
                  ({formatRevenueAmount(revenueAnalytics.unassignedLevelAmount)}) لعدم توفر مستوى دراسي مرتبط بالتلميذ.
                </p>
              )}
            </div>

            <div style={{ marginTop: 20, borderTop: "1px solid #edf1ef", paddingTop: 18 }}>
              <h3 style={{ margin: "0 0 12px" }}>تفصيل المداخيل الشهرية حسب المستوى</h3>
              {revenueAnalytics.months.every((month) => month.paymentCount === 0) ? (
                <p className="empty" style={{ textAlign: "center" }}>
                  سيظهر التفصيل هنا بعد تسجيل الأداءات.
                </p>
              ) : (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>الشهر الدراسي</th>
                        <th>المستوى الدراسي</th>
                        <th>عدد التلاميذ المؤدين</th>
                        <th>عدد الأداءات المسجلة</th>
                        <th>المبلغ المحصل (DH)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {revenueAnalytics.months.flatMap((month) =>
                        revenueLevels.map((level) => {
                          const row = revenueAnalytics.monthlyByLevel.find(
                            (item) =>
                              item.monthKey === month.key &&
                              item.levelCode === level.levelCode
                          );
                          return (
                            <tr key={`${month.key}-${level.levelCode}`}>
                              <td>{month.label} {month.year}</td>
                              <td>{level.label}</td>
                              <td>{row?.studentCount ?? 0}</td>
                              <td>{row?.paymentCount ?? 0}</td>
                              <td>{formatRevenueAmount(row?.amount ?? 0)}</td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        )}
      </section>

      <section className="dashboard-finance">
        <div className="panel-head">
          <div><h2>التلاميذ حسب المستوى</h2><p>عدد التلاميذ النشيطين حسب المستوى الدراسي.</p></div>
          <strong>إجمالي التلاميذ: {loadingStats ? "..." : studentCount}</strong>
        </div>
        <div className="stats">
          {levels.map((level) => {
            const code = levelToCode[level];
            return <article className="stat-card" key={code}><div className="stat-icon mint"><Icon name="users" /></div><div><span>{level}</span><strong>{loadingStats ? "..." : `${levelCounts[code] ?? 0} تلميذ`}</strong></div></article>;
          })}
        </div>
      </section>

      <section className="dashboard-finance">
        <div className="panel-head"><div><h2>إحصائيات الحضور</h2><p>الحضور المسجل في حصص اليوم المختار.</p></div><label>التاريخ<input type="date" value={attendanceDate} onChange={(event) => setAttendanceDate(event.target.value)} /></label></div>
        <div className="stats">
          {([["present", "حضور اليوم"], ["absent", "غياب اليوم"], ["late", "متأخرون اليوم"], ["excused", "غياب بعذر اليوم"]] as const).map(([status, label]) => <article className="stat-card" key={status}><div className="stat-icon sky"><Icon name="calendar" /></div><div><span>{label}</span><strong>{loadingStats ? "..." : attendanceStats[status]}</strong></div></article>)}
          <article className="stat-card"><div className="stat-icon lavender"><Icon name="chart" /></div><div><span>نسبة الحضور اليوم</span><strong>{loadingStats ? "..." : `${Object.values(attendanceStats).reduce((sum, value) => sum + value, 0) === 0 ? 0 : Math.round(attendanceStats.present / Object.values(attendanceStats).reduce((sum, value) => sum + value, 0) * 100)}%`}</strong></div></article>
        </div>
      </section>

      <section className="charts">
        <section className="panel distribution">
          <div className="panel-head">
            <div>
              <h2>{t("students")}</h2>
              <p>{t("studentCount")}</p>
            </div>
          </div>

          <div className="donut">
            <div>
              <strong>{studentCount}</strong>
              <span>{t("students")}</span>
            </div>
          </div>
        </section>
      </section>
    </>
  );
}

function StudentModal({
  close,
  onSaved,
  student,
}: {
  close: () => void;
  onSaved: (student: Student, isEdit: boolean) => void;
  student?: Student | null;
}) {
  const { t } = useLanguage();
  const isEdit = Boolean(student);

  const [fullName, setFullName] = useState(student?.full_name ?? "");
  const [phone, setPhone] = useState(student?.phone ?? "");
  const [email, setEmail] = useState(student?.email ?? "");
  const [level, setLevel] = useState(
    student ? codeToLevel[student.level_code] ?? student.level_code : ""
  );
  const [room, setRoom] = useState(student?.room ?? "");
  const [monthlyFee, setMonthlyFee] = useState(
    student?.monthly_fee != null ? String(student.monthly_fee) : ""
  );
  const [registrationDate, setRegistrationDate] = useState(
    student?.registration_date ?? ""
  );
  const [guardianName, setGuardianName] = useState(student?.guardian_name ?? "");
  const [guardianPhone, setGuardianPhone] = useState(student?.guardian_phone ?? "");
  const [notes, setNotes] = useState(student?.notes ?? "");
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [teacherId, setTeacherId] = useState(student?.teacher_id ?? "");
  const [compensationType, setCompensationType] = useState<"percentage" | "fixed_monthly_salary" | "">(
    student?.teacher_compensation_type ?? ""
  );
  const [percentage, setPercentage] = useState(
    student?.teacher_compensation_percentage != null
      ? String(student.teacher_compensation_percentage)
      : "50"
  );
  const [fixedSalary, setFixedSalary] = useState(
    student?.teacher_fixed_monthly_salary != null
      ? String(student.teacher_fixed_monthly_salary)
      : ""
  );

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void (async () => {
        const supabase = createClient();
        const extendedQuery = await supabase
          .from("teachers")
          .select("id, full_name, phone, email, specialty, monthly_salary, notes, is_active, created_at, updated_at, default_compensation_type, default_compensation_percentage")
          .eq("is_active", true)
          .order("full_name");
        if (!extendedQuery.error) {
          setTeachers((extendedQuery.data ?? []) as Teacher[]);
          return;
        }

        console.error("Teacher dropdown Supabase error", {
          message: extendedQuery.error.message,
          details: extendedQuery.error.details,
          hint: extendedQuery.error.hint,
          code: extendedQuery.error.code,
        });

        const legacyQuery = await supabase
          .from("teachers")
          .select("id, full_name, phone, email, specialty, monthly_salary, notes, created_at, updated_at")
          .order("full_name");
        setTeachers((legacyQuery.data ?? []).map((teacher) => ({
          ...teacher,
          is_active: true,
          default_compensation_type: "percentage" as const,
          default_compensation_percentage: 50,
        })) as Teacher[]);
      })();
    }, 0);

    return () => window.clearTimeout(timer);
  }, []);

  function selectTeacher(nextTeacherId: string) {
    setTeacherId(nextTeacherId);
    if (!nextTeacherId) {
      setCompensationType("");
      return;
    }

    const teacher = teachers.find((item) => item.id === nextTeacherId);
    if (teacher) {
      setCompensationType(teacher.default_compensation_type ?? "percentage");
      setPercentage(String(teacher.default_compensation_percentage ?? 50));
      setFixedSalary(teacher.monthly_salary == null ? "" : String(teacher.monthly_salary));
    }
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!fullName.trim()) {
      setError("المرجو إدخال اسم التلميذ.");
      return;
    }

    if (!phone.trim()) {
      setError("المرجو إدخال رقم الهاتف.");
      return;
    }

    if (!level) {
      setError("المرجو اختيار المستوى.");
      return;
    }

    if (!registrationDate) {
      setError("تاريخ التسجيل إجباري.");
      return;
    }

    if (!monthlyFee.trim()) {
      setError("المرجو إدخال الثمن الشهري.");
      return;
    }

    const monthlyFeeValue = Number(monthlyFee);

    if (!Number.isFinite(monthlyFeeValue) || monthlyFeeValue <= 0) {
      setError("الثمن الشهري يجب أن يكون مبلغاً صحيحاً أكبر من 0.");
      return;
    }

    const levelCode = levelToCode[level];

    if (!levelCode) {
      setError("المستوى غير صحيح.");
      return;
    }

    const percentageValue = Number(percentage);
    const fixedSalaryValue = Number(fixedSalary);

    if (teacherId && !compensationType) {
      setError("المرجو اختيار طريقة أجر الأستاذ.");
      return;
    }

    if (teacherId && compensationType === "percentage" && (!Number.isFinite(percentageValue) || percentageValue < 0 || percentageValue > 100)) {
      setError("النسبة يجب أن تكون بين 0 و100.");
      return;
    }

    if (teacherId && compensationType === "fixed_monthly_salary" && (!Number.isFinite(fixedSalaryValue) || fixedSalaryValue < 0)) {
      setError("الأجر الشهري الثابت يجب أن يكون مبلغاً صحيحاً أكبر أو يساوي 0.");
      return;
    }

    setLoading(true);
    setError("");

    const supabase = createClient();
    const payload = {
      full_name: fullName.trim(),
      phone: phone.trim(),
      email: email.trim() || null,
      level_code: levelCode,
      room: room || null,
      monthly_fee: monthlyFeeValue,
      registration_date: registrationDate,
      guardian_name: guardianName.trim() || null,
      guardian_phone: guardianPhone.trim() || null,
      notes: notes.trim() || null,
      is_active: true,
      teacher_id: teacherId || null,
      teacher_compensation_type: teacherId ? compensationType : null,
      teacher_compensation_percentage: teacherId && compensationType === "percentage" ? percentageValue : null,
      teacher_fixed_monthly_salary: teacherId && compensationType === "fixed_monthly_salary" ? fixedSalaryValue : null,
    };

    const query = isEdit && student
      ? supabase.from("students").update(payload).eq("id", student.id).select("*").single()
      : supabase.from("students").insert(payload).select("*").single();
    let { data, error: saveError } = await query;

    if (saveError) {
      console.error("Student save Supabase error", {
        message: saveError.message,
        details: saveError.details,
        hint: saveError.hint,
        code: saveError.code,
      });
    }

    if (saveError && !teacherId && isCompensationSchemaError(saveError)) {
      const legacyPayload = {
        full_name: fullName.trim(),
        phone: phone.trim(),
        email: email.trim() || null,
        level_code: levelCode,
        room: room || null,
        monthly_fee: monthlyFeeValue,
        registration_date: registrationDate,
        guardian_name: guardianName.trim() || null,
        guardian_phone: guardianPhone.trim() || null,
        notes: notes.trim() || null,
        is_active: true,
      };
      const legacyQuery = isEdit && student
        ? supabase.from("students").update(legacyPayload).eq("id", student.id).select("*").single()
        : supabase.from("students").insert(legacyPayload).select("*").single();
      ({ data, error: saveError } = await legacyQuery);
    }

    if (saveError) {
      console.error(saveError);
      setError(
        isEdit
          ? "وقع مشكل أثناء تعديل بيانات التلميذ."
          : "وقع مشكل أثناء تسجيل التلميذ. تأكد من الاتصال بقاعدة البيانات."
      );
      setLoading(false);
      return;
    }

    if (data) {
      onSaved(data as Student, isEdit);
    }

    setLoading(false);
    close();
  }

  return (
    <div className="modal-layer" onMouseDown={close}>
      <form
        className="student-modal"
        onMouseDown={(e) => e.stopPropagation()}
        onSubmit={handleSubmit}
      >
        <div className="modal-head">
          <div>
            <h2>{isEdit ? t("edit") : t("addTitle")}</h2>
            <p>
              {isEdit
                ? "تعديل معلومات التلميذ وحفظ التغييرات."
                : t("addDesc")}
            </p>
          </div>

          <button type="button" onClick={close} className="close">
            ×
          </button>
        </div>

        <div className="form-grid">
          <label>
            {t("fullName")}
            <input
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              required
            />
          </label>

          <label>
            {t("phone")}
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              required
            />
          </label>

          <label>
            البريد الإلكتروني
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>

          <label>
            {t("level")}
            <select
              required
              value={level}
              onChange={(e) => setLevel(e.target.value)}
            >
              <option value="" disabled>
                {t("chooseLevel")}
              </option>
              {levels.map((x) => (
                <option key={x} value={x}>
                  {x}
                </option>
              ))}
            </select>
          </label>

          <label>
            القاعة
            <select value={room} onChange={(e) => setRoom(e.target.value)}>
              <option value="">اختيار القاعة</option>
              {rooms.map((x) => (
                <option key={x} value={x}>
                  {x}
                </option>
              ))}
            </select>
          </label>

          <label>
            {t("registrationDate")} <span className="required">*</span>
            <input
              type="date"
              required
              value={registrationDate}
              onChange={(e) => setRegistrationDate(e.target.value)}
              name="registrationDate"
            />
          </label>

          <label>
            الثمن الشهري (د.م) <span className="required">*</span>
            <input
              type="number"
              required
              min="0.01"
              step="0.01"
              inputMode="decimal"
              value={monthlyFee}
              onChange={(e) => setMonthlyFee(e.target.value)}
              placeholder="مثال: 200"
            />
          </label>

          <label>
            الأستاذ المسؤول
            <select value={teacherId} onChange={(event) => selectTeacher(event.target.value)}>
              <option value="">بدون أستاذ مسؤول</option>
              {teachers.map((teacher) => (
                <option key={teacher.id} value={teacher.id}>{teacher.full_name}</option>
              ))}
            </select>
          </label>

          {teacherId && (
            <div className="form-wide" style={{ background: "#f7faf8", border: "1px solid #e4eee9", borderRadius: 10, padding: 14 }}>
              <strong style={{ display: "block", marginBottom: 10 }}>طريقة أجر الأستاذ</strong>
              <div style={{ display: "flex", gap: 18, flexWrap: "wrap" }}>
                <label style={{ display: "flex", alignItems: "center", gap: 7 }}>
                  <input type="radio" checked={compensationType === "percentage"} onChange={() => setCompensationType("percentage")} />
                  نسبة من أداء التلميذ
                </label>
                <label style={{ display: "flex", alignItems: "center", gap: 7 }}>
                  <input type="radio" checked={compensationType === "fixed_monthly_salary"} onChange={() => setCompensationType("fixed_monthly_salary")} />
                  راتب شهري ثابت
                </label>
              </div>

              {compensationType === "percentage" ? (
                <div style={{ marginTop: 12 }}>
                  <label>
                    النسبة
                    <select value={["50", "60", "70"].includes(percentage) ? percentage : "custom"} onChange={(event) => { if (event.target.value !== "custom") setPercentage(event.target.value); }}>
                      <option value="50">50%</option>
                      <option value="60">60%</option>
                      <option value="70">70%</option>
                      <option value="custom">نسبة مخصصة</option>
                    </select>
                  </label>
                  {!["50", "60", "70"].includes(percentage) && (
                    <input type="number" min="0" max="100" step="0.01" value={percentage} onChange={(event) => setPercentage(event.target.value)} placeholder="مثال: 65" style={{ marginTop: 8 }} />
                  )}
                </div>
              ) : (
                <label style={{ marginTop: 12 }}>
                  المبلغ الثابت الشهري (د.م)
                  <input type="number" min="0" step="0.01" value={fixedSalary} onChange={(event) => setFixedSalary(event.target.value)} />
                </label>
              )}

              {compensationType === "percentage" && (
                <div style={{ marginTop: 12, color: "#52645d", fontSize: 12, lineHeight: 1.8 }}>
                  <div>ثمن التلميذ الشهري: <strong>{Number(monthlyFee || 0).toLocaleString("fr-FR")} د.م</strong></div>
                  <div>نسبة الأستاذ: <strong>{Number(percentage || 0)}%</strong></div>
                  <div>حصة الأستاذ: <strong>{(Number(monthlyFee || 0) * Number(percentage || 0) / 100).toLocaleString("fr-FR")} د.م</strong></div>
                  <div>حصة المركز: <strong>{(Number(monthlyFee || 0) * (1 - Number(percentage || 0) / 100)).toLocaleString("fr-FR")} د.م</strong></div>
                </div>
              )}
            </div>
          )}

          <label>
            {t("guardian")}
            <input
              value={guardianName}
              onChange={(e) => setGuardianName(e.target.value)}
            />
          </label>

          <label>
            {t("guardianPhone")}
            <input
              value={guardianPhone}
              onChange={(e) => setGuardianPhone(e.target.value)}
            />
          </label>

          <label className="form-wide">
            {t("notes")}
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </label>
        </div>

        <p className="date-note">{t("dateNote")}</p>

        {error && (
          <p
            style={{
              color: "#b42318",
              background: "#fef3f2",
              padding: "10px 12px",
              borderRadius: "10px",
              marginTop: "12px",
            }}
          >
            {error}
          </p>
        )}

        <div className="modal-actions">
          <button
            type="button"
            className="secondary"
            onClick={close}
            disabled={loading}
          >
            {t("cancel")}
          </button>

          <button type="submit" className="primary" disabled={loading}>
            {loading ? "جاري الحفظ..." : isEdit ? t("edit") : t("add")}
          </button>
        </div>
      </form>
    </div>
  );
}

function PaymentInvoiceModal({
  student,
  close,
  initialMonth,
  initialPaymentId,
  initialAction,
  whatsAppMessageLanguage,
  onInitialActionComplete,
  onPdfGenerated,
}: {
  student: Student;
  close: () => void;
  initialMonth?: string;
  initialPaymentId?: string | null;
  initialAction?: "view" | "download" | "print" | "whatsapp";
  whatsAppMessageLanguage?: "ar" | "fr";
  onInitialActionComplete?: (succeeded: boolean) => void;
  onPdfGenerated?: (file: File) => void;
}) {
  const { lang } = useLanguage();
  const [month, setMonth] = useState(() => {
    if (initialMonth) return initialMonth;
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  });
  const [amountPaid, setAmountPaid] = useState(
    student.monthly_fee != null ? String(student.monthly_fee) : ""
  );
  const [paymentDate, setPaymentDate] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  });
  const [editingPaymentId, setEditingPaymentId] = useState<string | null>(null);
  const [editingOriginalAmount, setEditingOriginalAmount] = useState(0);
  const [editingCompensationType, setEditingCompensationType] = useState<"percentage" | "fixed_monthly_salary" | null>(null);
  const [editingCompensationPercentage, setEditingCompensationPercentage] = useState<number | null>(null);
  const [isPartialPayment, setIsPartialPayment] = useState(false);
  const [payments, setPayments] = useState<
    { id: string; amount_paid: number; payment_date: string; teacher_id: string | null; compensation_type_snapshot: "percentage" | "fixed_monthly_salary" | null; compensation_percentage_snapshot: number | null }[]
  >([]);
  const [previousPaid, setPreviousPaid] = useState(0);
  const [loading, setLoading] = useState(false);
  const [loadingMonth, setLoadingMonth] = useState(false);
  const [loadingInvoice, setLoadingInvoice] = useState(Boolean(initialPaymentId));
  const [error, setError] = useState("");
  const [invoiceShareError, setInvoiceShareError] = useState("");
  const [invoiceShareNotice, setInvoiceShareNotice] = useState("");
  const [whatsAppInvoiceUrl, setWhatsAppInvoiceUrl] = useState<string | null>(null);
  const [sharingInvoice, setSharingInvoice] = useState(false);
  const [showWhatsAppRecipientDialog, setShowWhatsAppRecipientDialog] = useState(false);
  const [whatsAppRecipientPurpose, setWhatsAppRecipientPurpose] = useState<"invoice" | "message">("invoice");
  const [deletePaymentId, setDeletePaymentId] = useState<string | null>(null);
  const [deleteReason, setDeleteReason] = useState("");
  const [receipt, setReceipt] = useState<{
    paymentDate: string;
    paymentMonth: string;
    dueAmount: number;
    amountThisPayment: number;
    remainingAmount: number;
    totalPaid: number;
    partialPayment: boolean;
    statusLabel: string;
  } | null>(null);
  const [whatsAppDraft, setWhatsAppDraft] = useState<{
    type: WhatsAppMessageType;
    message: string;
    guardianPhone: string | null;
    guardianName: string;
    amountPaid?: number;
    paymentDate?: string;
    month: string;
  } | null>(null);
  const handledInitialAction = useRef(false);

  const loadMonthPayments = useCallback(async (selectedMonth: string) => {
    setLoadingMonth(true);
    const supabase = createClient();
    const start = `${selectedMonth}-01`;
    const [year, monthNumber] = selectedMonth.split("-").map(Number);
    const nextMonth = new Date(Date.UTC(year, monthNumber, 1));
    const nextStart = `${nextMonth.getUTCFullYear()}-${String(
      nextMonth.getUTCMonth() + 1
    ).padStart(2, "0")}-01`;

    const { data, error: fetchError } = await supabase
      .from("payments")
      .select("id, amount_paid, payment_date, teacher_id, compensation_type_snapshot, compensation_percentage_snapshot")
      .eq("student_id", student.id)
      .is("deleted_at", null)
      .gte("payment_month", start)
      .lt("payment_month", nextStart);

    if (fetchError) {
      console.error(fetchError);
      setPayments([]);
      setPreviousPaid(0);
    } else {
      const rows = (data ?? []).map((item) => ({
        id: String(item.id),
        amount_paid: Number(item.amount_paid ?? 0),
        payment_date: String(item.payment_date ?? ""),
        teacher_id: item.teacher_id ? String(item.teacher_id) : null,
        compensation_type_snapshot: item.compensation_type_snapshot as "percentage" | "fixed_monthly_salary" | null,
        compensation_percentage_snapshot: item.compensation_percentage_snapshot == null ? null : Number(item.compensation_percentage_snapshot),
      }));
      const paidTotal = rows.reduce((sum, item) => sum + item.amount_paid, 0);
      setPayments(rows);
      setPreviousPaid(paidTotal);
      if (!editingPaymentId) {
        const fee = Number(student.monthly_fee ?? 0);
        setAmountPaid(String(Math.max(fee - paidTotal, 0)));
      }
    }

    setLoadingMonth(false);
  }, [editingPaymentId, student.id, student.monthly_fee]);

  useEffect(() => {
    if (initialPaymentId) {
      const loadInvoicePayment = async () => {
        const supabase = createClient();
        const { data, error: fetchError } = await supabase
          .from("payments")
          .select("id, payment_month, payment_date, amount_paid")
          .eq("id", initialPaymentId)
          .is("deleted_at", null)
          .maybeSingle();

        if (fetchError || !data) {
          console.error(fetchError ?? "Missing payment row for invoice.");
          setError("تعذر تحميل الفاتورة المطلوبة.");
          setLoadingInvoice(false);
          if (initialAction === "download") onInitialActionComplete?.(false);
          return;
        }

        const dueAmount = Number(student.monthly_fee ?? 0);
        const amountPaidValue = Number(data.amount_paid ?? 0);
        const paymentMonth = String(data.payment_month ?? initialMonth ?? month);
        const paymentDateValue = String(data.payment_date ?? paymentDate);
        setMonth(paymentMonth.slice(0, 7));
        setAmountPaid(String(amountPaidValue));
        setPaymentDate(paymentDateValue);
        setReceipt({
          paymentDate: paymentDateValue,
          paymentMonth,
          dueAmount,
          amountThisPayment: amountPaidValue,
          remainingAmount: Math.max(dueAmount - amountPaidValue, 0),
          totalPaid: amountPaidValue,
          partialPayment: amountPaidValue > 0 && amountPaidValue < dueAmount,
          statusLabel: amountPaidValue >= dueAmount ? "Payé" : amountPaidValue > 0 ? "Paiement partiel" : "Non payé",
        });
        setLoadingInvoice(false);
      };

      void loadInvoicePayment();
      return;
    }

    const timer = window.setTimeout(() => {
      setEditingPaymentId(null);
      setEditingOriginalAmount(0);
      setEditingCompensationType(null);
      setEditingCompensationPercentage(null);
      setError("");
      void loadMonthPayments(month);
    }, 0);

    return () => window.clearTimeout(timer);
  }, [initialAction, initialPaymentId, initialMonth, loadMonthPayments, month, onInitialActionComplete, paymentDate, student.id, student.monthly_fee]);

  const monthlyFee = Number(student.monthly_fee ?? 0);
  const enteredAmount = Number(amountPaid || 0);
  const basePaid = Math.max(previousPaid - editingOriginalAmount, 0);
  const totalPaid = basePaid + enteredAmount;
  const remaining = Math.max(monthlyFee - totalPaid, 0);

  async function deletePayment() {
    if (!deletePaymentId) return;

    const reason = deleteReason.trim();
    if (!reason) {
      setError("المرجو كتابة سبب حذف الأداء.");
      return;
    }

    setLoading(true);
    setError("");

    const supabase = createClient();
    const { error: deleteError } = await supabase
      .from("payments")
      .update({
        deleted_at: new Date().toISOString(),
        deleted_reason: reason,
      })
      .eq("id", deletePaymentId)
      .is("deleted_at", null);

    if (deleteError) {
      console.error(deleteError);
      setError(`وقع مشكل أثناء حذف الأداء: ${deleteError.message}`);
      setLoading(false);
      return;
    }

    setDeletePaymentId(null);
    setDeleteReason("");
    setEditingPaymentId(null);
    setEditingOriginalAmount(0);
    setEditingCompensationType(null);
    setEditingCompensationPercentage(null);
    await loadMonthPayments(month);
    setLoading(false);
  }

  async function handlePayment(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!month) {
      setError("المرجو اختيار الشهر.");
      return;
    }

    if (!Number.isFinite(enteredAmount) || enteredAmount <= 0) {
      setError("المرجو إدخال مبلغ الأداء.");
      return;
    }

    if (monthlyFee <= 0) {
      setError("الثمن الشهري غير محدد لهذا التلميذ.");
      return;
    }

    if (totalPaid > monthlyFee) {
      setError(`المبلغ الإجمالي لهذا الشهر لا يمكن أن يتجاوز ${monthlyFee} د.م.`);
      return;
    }

    setLoading(true);
    setError("");

    const supabase = createClient();
    let saveError = null;
    const dueAmountForThisPeriod = monthlyFee;
    const nextRemainingAmount = isPartialPayment ? Math.max(dueAmountForThisPeriod - enteredAmount, 0) : 0;

    if (editingPaymentId) {
      const result = await supabase
        .from("payments")
        .update({
          amount_paid: enteredAmount,
          payment_date: paymentDate,
          payment_month: `${month}-01`,
          teacher_share: editingCompensationType === "percentage" ? enteredAmount * Number(editingCompensationPercentage ?? 0) / 100 : 0,
          center_share: editingCompensationType === "percentage" ? enteredAmount - (enteredAmount * Number(editingCompensationPercentage ?? 0) / 100) : enteredAmount,
        })
        .eq("id", editingPaymentId);
      saveError = result.error;
    } else {
      const result = await supabase.from("payments").insert({
        student_id: student.id,
        payment_month: `${month}-01`,
        amount_paid: enteredAmount,
        payment_date: paymentDate,
        teacher_id: student.teacher_id,
        compensation_type_snapshot: student.teacher_id ? student.teacher_compensation_type : null,
        compensation_percentage_snapshot: student.teacher_id && student.teacher_compensation_type === "percentage" ? student.teacher_compensation_percentage : null,
        teacher_share: student.teacher_id && student.teacher_compensation_type === "percentage" ? enteredAmount * Number(student.teacher_compensation_percentage ?? 0) / 100 : 0,
        center_share: student.teacher_id && student.teacher_compensation_type === "percentage" ? enteredAmount - (enteredAmount * Number(student.teacher_compensation_percentage ?? 0) / 100) : enteredAmount,
      });
      saveError = result.error;
    }

    if (saveError) {
      console.error(saveError);
      setError(`وقع مشكل أثناء ${editingPaymentId ? "تعديل" : "تسجيل"} الأداء.`);
      setLoading(false);
      return;
    }

    await loadMonthPayments(month);
    setReceipt({
      paymentDate,
      paymentMonth: month,
      dueAmount: dueAmountForThisPeriod,
      amountThisPayment: enteredAmount,
      remainingAmount: nextRemainingAmount,
      totalPaid,
      partialPayment: isPartialPayment,
      statusLabel: isPartialPayment ? "Paiement partiel" : "Payé",
    });
    setLoading(false);
  }

  const printInvoice = useCallback(() => {
    window.print();
  }, []);

  async function sendWhatsAppMessage() {
    if (!whatsAppDraft) return;

    const payload = {
      studentId: student.id,
      studentName: student.full_name,
      guardianName: whatsAppDraft.guardianName,
      guardianPhone: whatsAppDraft.guardianPhone,
      messageType: whatsAppDraft.type,
      messageContent: whatsAppDraft.message,
      month: whatsAppDraft.month,
      amountPaid: whatsAppDraft.amountPaid,
      paymentDate: whatsAppDraft.paymentDate,
    };

    try {
      const response = await fetch("/api/whatsapp/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const result = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(result?.error || "Unable to send WhatsApp message.");
      }

      setWhatsAppDraft(null);
      setError(result?.status === "duplicate" ? "تم إرسال هذا التنبيه بالفعل لهذا التلميذ وهذا الشهر." : "تم إرسال الرسالة عبر واتساب بنجاح.");
    } catch (error) {
      console.error(error);
      setError(error instanceof Error ? error.message : "تعذر إرسال الرسالة عبر واتساب.");
    }
  }

  function openWhatsAppComposer(type: WhatsAppMessageType) {
    const guardianName = student.guardian_name?.trim() || "ولي الأمر";
    const guardianPhone = student.guardian_phone || student.phone;
    const monthKey = month;

    const message = type === "payment_confirmation"
      ? buildPaymentConfirmationMessage({
          guardianName,
          studentName: student.full_name,
          amountPaid: receipt?.amountThisPayment ?? Number(amountPaid || 0),
          month: monthKey,
          paymentDate: receipt?.paymentDate ?? paymentDate,
        })
      : buildMonthlyReminderMessage({
          guardianName,
          studentName: student.full_name,
          month: monthKey,
        });

    setWhatsAppDraft({
      type,
      guardianName,
      guardianPhone,
      amountPaid: receipt?.amountThisPayment ?? Number(amountPaid || 0),
      paymentDate: receipt?.paymentDate ?? paymentDate,
      month: monthKey,
      message,
    });
    setWhatsAppRecipientPurpose("message");
    setShowWhatsAppRecipientDialog(true);
  }

  const sanitizeInvoiceFileName = useCallback((value: string) => {
    return value
      .trim()
      .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "")
      .replace(/\s+/g, " ")
      .replace(/[. ]+$/g, "");
  }, []);

  const buildInvoicePdfFileName = useCallback((studentName: string, selectedMonth: string) => {
    const [year, monthNumber] = selectedMonth.split("-").map(Number);
    const monthLabel = new Date(Date.UTC(year, monthNumber - 1, 1)).toLocaleDateString("en-US", {
      month: "long",
      timeZone: "UTC",
    });
    const baseName = `${sanitizeInvoiceFileName(studentName)}-${monthLabel}-${year}`;
    const storageKey = "sanabil-invoice-pdf-history";
    const existingNames = JSON.parse(localStorage.getItem(storageKey) ?? "[]");
    let candidate = baseName;
    let counter = 2;

    while (existingNames.includes(candidate)) {
      candidate = `${baseName}-${counter}`;
      counter += 1;
    }

    const updatedNames = [...existingNames, candidate];
    localStorage.setItem(storageKey, JSON.stringify(updatedNames.slice(-200)));

    return `${candidate}.pdf`;
  }, [sanitizeInvoiceFileName]);

  const saveInvoicePdf = useCallback(async () => {
    const invoiceNode = document.querySelector(".print-invoice") as HTMLElement | null;

    if (!invoiceNode) {
      console.error("Invoice element not found for PDF export.");
      setInvoiceShareError("تعذر العثور على الفاتورة لإنشاء ملف PDF.");
      return false;
    }

    let clone: HTMLElement | null = null;
    try {
      clone = invoiceNode.cloneNode(true) as HTMLElement;
      clone.style.position = "fixed";
      clone.style.left = "-9999px";
      clone.style.top = "0";
      clone.style.width = "148mm";
      clone.style.maxWidth = "148mm";
      clone.style.height = "auto";
      clone.style.boxSizing = "border-box";
      clone.style.padding = "10mm 8mm 8mm";
      clone.style.margin = "0";
      clone.style.background = "#ffffff";
      clone.style.overflow = "visible";
      clone.style.border = "0";
      clone.style.borderRadius = "0";
      clone.style.boxShadow = "none";

      const logo = clone.querySelector(".invoice-logo") as HTMLImageElement | null;
      if (logo) {
        logo.style.width = "68px";
        logo.style.height = "auto";
        logo.style.maxWidth = "68px";
        logo.style.maxHeight = "54px";
        logo.style.objectFit = "contain";
        logo.style.objectPosition = "center";
        logo.style.display = "block";
        logo.style.flexShrink = "0";
      }

      const header = clone.querySelector(".invoice-header") as HTMLElement | null;
      if (header) {
        header.style.overflow = "visible";
      }

      document.body.appendChild(clone);

      const canvas = await html2canvas(clone, {
        scale: 2,
        useCORS: true,
        backgroundColor: "#ffffff",
        scrollX: 0,
        scrollY: 0,
        width: 148 * 3.78,
        height: 210 * 3.78,
      });

      const pdf = new jsPDF({
        orientation: "portrait",
        unit: "mm",
        format: [148, 210],
      });

      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const imgData = canvas.toDataURL("image/png");
      const imgProps = pdf.getImageProperties(imgData);
      const imgRatio = Math.min(pageWidth / imgProps.width, pageHeight / imgProps.height);
      const imgWidth = imgProps.width * imgRatio;
      const imgHeight = imgProps.height * imgRatio;
      const x = (pageWidth - imgWidth) / 2;
      const y = (pageHeight - imgHeight) / 2;

      pdf.addImage(imgData, "PNG", x, y, imgWidth, imgHeight, undefined, "FAST");
      const fileName = buildInvoicePdfFileName(student.full_name, month);
      const file = new File([pdf.output("blob")], fileName, { type: "application/pdf" });
      pdf.save(fileName);
      onPdfGenerated?.(file);
      return file;
    } catch (error) {
      console.error("Failed to generate invoice PDF:", error);
      setInvoiceShareError("تعذر إنشاء ملف PDF للفاتورة. يرجى المحاولة مرة أخرى.");
      return null;
    } finally {
      clone?.remove();
    }
  }, [buildInvoicePdfFileName, month, onPdfGenerated, student.full_name]);

  const shareInvoiceViaWhatsApp = useCallback(async (recipientPhone: string) => {
    setInvoiceShareError("");
    setInvoiceShareNotice("");
    setWhatsAppInvoiceUrl(null);

    const normalizedPhone = normalizeMoroccanMobileNumber(recipientPhone);
    if (!normalizedPhone) {
      setInvoiceShareError(
        lang === "ar"
          ? "رقم الهاتف غير صالح. أدخل رقم محمول مغربي يبدأ بـ 06 أو 07."
          : "Le numéro saisi est invalide. Saisissez un mobile marocain commençant par 06 ou 07."
      );
      return;
    }

    const invoiceMonth = (receipt?.paymentMonth || month).slice(0, 7);
    const invoiceAmounts = receipt
      ? [receipt.dueAmount, receipt.totalPaid, receipt.remainingAmount]
      : [];
    if (
      !receipt ||
      !student.full_name.trim() ||
      !/^\d{4}-(0[1-9]|1[0-2])$/.test(invoiceMonth) ||
      student.monthly_fee == null ||
      !invoiceAmounts.every((amount) => Number.isFinite(amount) && amount >= 0)
    ) {
      setInvoiceShareError(
        lang === "ar"
          ? "بيانات الفاتورة غير مكتملة. تحقق من اسم التلميذ والشهر والمبالغ."
          : "Les données de la facture sont incomplètes. Vérifiez le nom, le mois et les montants."
      );
      return;
    }

    const message = buildInvoiceWhatsAppMessage({
      studentName: student.full_name.trim(),
      month: invoiceMonth,
      totalAmount: receipt.dueAmount,
      paidAmount: receipt.totalPaid,
      balance: receipt.remainingAmount,
      lang: whatsAppMessageLanguage ?? lang,
    });
    const whatsAppUrl = buildWhatsAppWebUrl(normalizedPhone, message);
    if (!whatsAppUrl) {
      setInvoiceShareError(
        lang === "ar" ? "تعذر إعداد رابط واتساب." : "Impossible de préparer le lien WhatsApp."
      );
      return;
    }

    const whatsAppPopup = window.open("about:blank", "_blank");
    setSharingInvoice(true);
    try {
      const pdfGenerated = await saveInvoicePdf();
      if (!pdfGenerated) {
        whatsAppPopup?.close();
        return;
      }

      setWhatsAppInvoiceUrl(whatsAppUrl);
      setInvoiceShareNotice(
        lang === "ar"
          ? "تم تنزيل الفاتورة. أرفق ملف PDF يدوياً في واتساب قبل الضغط على إرسال."
          : "La facture a été téléchargée. Joignez le PDF manuellement dans WhatsApp avant d'envoyer."
      );

      if (whatsAppPopup) {
        whatsAppPopup.opener = null;
        whatsAppPopup.location.href = whatsAppUrl;
      } else {
        setInvoiceShareError(
          lang === "ar"
            ? "تم تنزيل الفاتورة، لكن المتصفح منع فتح واتساب تلقائياً. استخدم الرابط أدناه."
            : "La facture a été téléchargée, mais le navigateur a bloqué WhatsApp. Utilisez le lien ci-dessous."
        );
      }
    } catch (error) {
      console.error("Failed to open WhatsApp invoice composer:", error);
      setInvoiceShareError(
        lang === "ar"
          ? "تم إنشاء الفاتورة، لكن تعذر فتح واتساب. استخدم الرابط أدناه."
          : "La facture a été créée, mais WhatsApp n'a pas pu s'ouvrir. Utilisez le lien ci-dessous."
      );
    } finally {
      setSharingInvoice(false);
    }
  }, [lang, month, receipt, saveInvoicePdf, student.full_name, student.monthly_fee, whatsAppMessageLanguage]);

  useEffect(() => {
    if (!initialPaymentId || !receipt || !initialAction || handledInitialAction.current) return;
    const timer = window.setTimeout(() => {
      handledInitialAction.current = true;

      if (initialAction === "download") {
        void saveInvoicePdf().then((file) => onInitialActionComplete?.(Boolean(file)));
      } else if (initialAction === "print") {
        printInvoice();
      } else if (initialAction === "whatsapp") {
        setWhatsAppRecipientPurpose("invoice");
        setShowWhatsAppRecipientDialog(true);
      }
    }, 0);

    return () => window.clearTimeout(timer);
  }, [initialAction, initialPaymentId, onInitialActionComplete, printInvoice, receipt, saveInvoicePdf]);

  function confirmWhatsAppRecipient(recipientPhone: string) {
    setShowWhatsAppRecipientDialog(false);
    if (whatsAppRecipientPurpose === "invoice") {
      void shareInvoiceViaWhatsApp(recipientPhone);
      return;
    }
    setWhatsAppDraft((current) =>
      current ? { ...current, guardianPhone: recipientPhone } : current
    );
  }

  if (receipt) {
    const receiptMonth = (receipt.paymentMonth || month).slice(0, 7);
    const monthLabel = new Date(`${receiptMonth}-01T00:00:00Z`).toLocaleDateString(
      "ar-MA",
      { month: "long", year: "numeric", timeZone: "UTC" }
    );

    return (
      <div className="modal-layer invoice-layer" onMouseDown={close}>
        <div className="invoice-modal" dir="rtl" onMouseDown={(e) => e.stopPropagation()}>
          <style jsx global>{`
            .invoice-layer { z-index: 1000; }
            .invoice-modal { width: min(760px, calc(100vw - 32px)); max-height: 92vh; overflow: auto; background: #fff; border-radius: 18px; padding: 20px; box-shadow: 0 20px 60px rgba(15, 23, 42, 0.18); }
            .invoice-actions { display: flex; justify-content: flex-end; gap: 10px; margin-bottom: 16px; }
            .print-invoice { background: #fff; color: #172033; padding: 30px; border: 1px solid #e7ebef; border-radius: 14px; }
            .invoice-header { display: grid; grid-template-columns: 90px 1fr auto; align-items: center; gap: 18px; padding-bottom: 20px; border-bottom: 2px solid #0f7f68; overflow: visible; }
            .invoice-logo {
              display: block;
              width: 78px;
              height: 78px;
              max-width: 78px;
              max-height: 78px;
              object-fit: contain;
              object-position: center;
              border-radius: 12px;
              flex-shrink: 0;
            }
            .invoice-header > div:first-child {
              display: flex;
              align-items: center;
              justify-content: center;
              overflow: visible;
            }
            .invoice-brand h1 { margin: 0 0 5px; font-size: 27px; }
            .invoice-brand p { margin: 0 0 5px; color: #657184; font-size: 14px; }
            .invoice-brand span { color: #0f7f68; font-size: 13px; font-weight: 700; }
            .invoice-title { text-align: left; direction: rtl; }
            .invoice-title strong { display: block; font-size: 20px; }
            .invoice-title small { display: block; margin-top: 5px; color: #7a8494; font-size: 10px; letter-spacing: .08em; }
            .invoice-number-row { display: flex; justify-content: space-between; gap: 16px; padding: 16px 0; font-size: 13px; color: #5c6675; }
            .invoice-student { display: grid; grid-template-columns: 2fr 1fr 1fr; gap: 12px; background: #f6faf8; padding: 16px; border-radius: 12px; margin-bottom: 18px; }
            .invoice-student span, .invoice-student strong { display: block; }
            .invoice-student span { font-size: 11px; color: #788292; margin-bottom: 5px; }
            .invoice-table { width: 100%; border-collapse: collapse; margin-top: 8px; }
            .invoice-table th, .invoice-table td { padding: 12px 10px; border-bottom: 1px solid #e7ebef; text-align: right; }
            .invoice-table th { background: #f7f8fa; font-size: 12px; color: #657184; }
            .invoice-table td:last-child, .invoice-table th:last-child { text-align: left; direction: ltr; }
            .invoice-paid td { font-weight: 700; }
            .invoice-total td { font-weight: 800; border-top: 2px solid #dce4e0; }
            .invoice-remaining td { font-weight: 800; font-size: 16px; }
            .invoice-status { margin-top: 18px; padding: 12px; border-radius: 10px; text-align: center; background: #eef8f4; color: #0f7f68; font-weight: 800; }
            .invoice-footer { text-align: center; margin-top: 28px; padding-top: 18px; border-top: 1px dashed #cfd7d3; }
            .invoice-footer p { margin: 0 0 5px; font-weight: 700; }
            .invoice-footer span { color: #7a8494; font-size: 11px; }
            .payment-summary { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-top: 18px; }
            .payment-summary > div { padding: 14px; background: #f7f8fa; border-radius: 10px; }
            .payment-summary span, .payment-summary strong { display: block; }
            .payment-summary span { font-size: 11px; color: #788292; margin-bottom: 6px; }
            .payment-summary strong { font-size: 16px; }
            .payment-summary .remaining { background: #eef8f4; color: #0f7f68; }
            .payment-history { margin-top: 16px; border: 1px solid #e7ebef; border-radius: 12px; overflow: hidden; }
            .payment-history-title { padding: 12px 14px; background: #f7f8fa; font-weight: 800; }
            .payment-history-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 12px 14px; border-top: 1px solid #e7ebef; }
            .payment-history-row div { display: flex; flex-direction: column; gap: 3px; }
            .payment-history-row span { font-size: 11px; color: #788292; }
            .secondary.small { padding: 7px 12px; font-size: 12px; }
            .form-error { color: #b42318; background: #fef3f2; padding: 10px 12px; border-radius: 10px; margin-top: 12px; }
            @media (max-width: 700px) {
              .invoice-header { grid-template-columns: 70px 1fr; }
              .invoice-title { grid-column: 1 / -1; text-align: right; }
              .invoice-student { grid-template-columns: 1fr; }
              .payment-summary { grid-template-columns: 1fr 1fr; }
              .print-invoice { padding: 18px; }
            }
            @media print {
              html, body {
                width: 148mm !important;
                height: 210mm !important;
                margin: 0 !important;
                padding: 0 !important;
                background: #fff !important;
              }
              body * { visibility: hidden !important; }
              .invoice-layer, .invoice-modal, .print-invoice, .print-invoice * {
                visibility: visible !important;
              }
              .invoice-layer {
                position: static !important;
                background: transparent !important;
                display: block !important;
                width: 148mm !important;
                min-height: 210mm !important;
                margin: 0 !important;
              }
              .invoice-modal {
                position: static !important;
                width: 148mm !important;
                max-width: 148mm !important;
                max-height: none !important;
                overflow: visible !important;
                padding: 0 !important;
                margin: 0 !important;
                box-shadow: none !important;
                border-radius: 0 !important;
                background: transparent !important;
              }
              .print-invoice {
                position: static !important;
                width: 148mm !important;
                min-height: 210mm !important;
                max-height: 210mm !important;
                box-sizing: border-box !important;
                padding: 10mm 8mm 8mm !important;
                margin: 0 !important;
                border: 0 !important;
                border-radius: 0 !important;
                box-shadow: none !important;
                overflow: visible !important;
                page-break-inside: avoid !important;
                break-inside: avoid !important;
              }
              .no-print { display: none !important; }
              .invoice-header {
                gap: 12px;
                padding-bottom: 14px;
              }
              .invoice-brand h1 { font-size: 24px; }
              .invoice-brand p { font-size: 12px; }
              .invoice-brand span { font-size: 12px; }
              .invoice-title strong { font-size: 18px; }
              .invoice-title small { font-size: 9px; }
              .invoice-number-row { padding: 12px 0; font-size: 12px; }
              .invoice-student { padding: 12px; margin-bottom: 12px; }
              .invoice-table th, .invoice-table td { padding: 9px 8px; }
              .invoice-status { margin-top: 12px; padding: 10px; }
              .invoice-footer { margin-top: 16px; padding-top: 12px; }
              @page {
                size: A5 portrait;
                margin: 0;
              }
            }
          `}</style>
          <div className="invoice-actions no-print">
            <button type="button" className="secondary" onClick={close}>
              إغلاق
            </button>
            <button type="button" className="secondary" onClick={saveInvoicePdf}>
              حفظ PDF على الكمبيوتر
            </button>
            <button type="button" className="primary" onClick={printInvoice}>
              طباعة الفاتورة
            </button>
          </div>

          <p className="no-print" style={{ margin: "0 0 12px", color: "#657184", fontSize: 12 }}>
            سيتم حفظ الفاتورة مباشرة كملف PDF بصيغة A5 وبصفحة واحدة.
          </p>
          <div className="print-invoice" dir="rtl">
            <div className="invoice-header">
              <div>
                <img
                  src="/images/logo.png"
                  alt="سنابل الكوثر"
                  className="invoice-logo"
                />
              </div>
              <div className="invoice-brand">
                <h1>سنابل الكوثر</h1>
                <p>مركز للدعم المدرسي والتكوين</p>
                <span>معاً نحو مستقبل أفضل</span>
              </div>
              <div className="invoice-title">
                <strong>وصل الأداء</strong>
                <small>REÇU DE PAIEMENT</small>
              </div>
            </div>

            <div className="invoice-number-row" dir="rtl">
              <span>تاريخ الأداء: <strong>{formatDate(receipt.paymentDate, "ar")}</strong></span>
              <span>الشهر المؤدى عنه: <strong>{monthLabel}</strong></span>
            </div>

            <div className="invoice-student">
              <div><span>التلميذ</span><strong>{student.full_name}</strong></div>
              <div><span>المستوى</span><strong>{codeToLevel[student.level_code] ?? student.level_code}</strong></div>
              <div><span>القاعة</span><strong>{student.room || "—"}</strong></div>
            </div>

            <table className="invoice-table">
              <thead>
                <tr>
                  <th>البيان</th>
                  <th>المبلغ</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>الشهر المؤدى عنه</td>
                  <td>{monthLabel}</td>
                </tr>
                {receipt.partialPayment && (
                  <tr>
                    <td>المبلغ المستحق</td>
                    <td>{receipt.dueAmount.toLocaleString("fr-FR")} د.م</td>
                  </tr>
                )}
                <tr className="invoice-paid">
                  <td>المبلغ المؤدى</td>
                  <td>{receipt.amountThisPayment.toLocaleString("fr-FR")} د.م</td>
                </tr>
                {receipt.partialPayment && (
                  <tr className="invoice-remaining">
                    <td>المبلغ المتبقي</td>
                    <td>{receipt.remainingAmount.toLocaleString("fr-FR")} د.م</td>
                  </tr>
                )}
                {!receipt.partialPayment && (
                  <tr className="invoice-total">
                    <td>المجموع المؤدى</td>
                    <td>{receipt.totalPaid.toLocaleString("fr-FR")} د.م</td>
                  </tr>
                )}
                {receipt.partialPayment && (
                  <tr className="invoice-total">
                    <td>مجموع المبلغ المؤدى</td>
                    <td>{receipt.totalPaid.toLocaleString("fr-FR")} د.م</td>
                  </tr>
                )}
              </tbody>
            </table>

            <div className="invoice-status">
              {receipt.partialPayment ? "أداء جزئي" : "مؤدى"}
            </div>

            <div className="invoice-footer">
              <p>شكراً لثقتكم في مركز سنابل الكوثر</p>
              <span>هذا الوصل يثبت عملية الأداء الخاصة بالشهر المذكور أعلاه.</span>
            </div>

            <div className="invoice-actions no-print" style={{ marginTop: 18, justifyContent: "flex-start" }}>
              <button
                type="button"
                className="primary"
                onClick={() => {
                  setWhatsAppRecipientPurpose("invoice");
                  setShowWhatsAppRecipientDialog(true);
                }}
                disabled={sharingInvoice}
              >
                {sharingInvoice ? "جارٍ إعداد الفاتورة..." : "إرسال الفاتورة عبر WhatsApp"}
              </button>
              <button type="button" className="secondary" onClick={() => openWhatsAppComposer("payment_confirmation")}>
                إرسال عبر واتساب
              </button>
            </div>

            {invoiceShareNotice && <p className="no-print" style={{ color: "#0f7f68" }}>{invoiceShareNotice}</p>}
            {invoiceShareError && <p className="no-print form-error">{invoiceShareError}</p>}
            {whatsAppInvoiceUrl && (
              <p className="no-print">
                <a href={whatsAppInvoiceUrl} target="_blank" rel="noreferrer" className="secondary small">
                  فتح WhatsApp Web
                </a>
              </p>
            )}

            {whatsAppDraft && (
              <div className="no-print" style={{ marginTop: 16, padding: 16, border: "1px solid #dfe7ee", borderRadius: 12, background: "#f8fafc" }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", marginBottom: 12 }}>
                  <strong>مراجعة رسالة واتساب</strong>
                  <button type="button" className="secondary small" onClick={() => setWhatsAppDraft(null)}>إغلاق</button>
                </div>
                <p style={{ margin: "0 0 10px", color: "#657184", fontSize: 12 }} dir="ltr">
                  {whatsAppDraft.guardianPhone}
                </p>
                <textarea
                  value={whatsAppDraft.message}
                  onChange={(event) => setWhatsAppDraft((current) => current ? { ...current, message: event.target.value } : current)}
                  rows={6}
                  style={{ width: "100%", resize: "vertical", boxSizing: "border-box" }}
                />
                <div style={{ marginTop: 12, display: "flex", justifyContent: "flex-end", gap: 10 }}>
                  <button type="button" className="secondary" onClick={() => setWhatsAppDraft(null)}>إلغاء</button>
                  <button type="button" className="primary" onClick={sendWhatsAppMessage}>إرسال الآن</button>
                </div>
              </div>
            )}
          </div>
        </div>
        {showWhatsAppRecipientDialog && (
          <WhatsAppRecipientDialog
            studentName={student.full_name}
            savedPhone={student.guardian_phone || student.phone}
            close={() => setShowWhatsAppRecipientDialog(false)}
            onConfirm={confirmWhatsAppRecipient}
          />
        )}
      </div>
    );
  }

  if (initialPaymentId) {
    return (
      <div className="modal-layer invoice-layer" dir="rtl" onMouseDown={close}>
        <div className="invoice-modal" onMouseDown={(event) => event.stopPropagation()}>
          <div className="modal-head">
            <div>
              <h2>الفاتورة المحفوظة</h2>
              <p>{student.full_name}</p>
            </div>
            <button type="button" className="close" onClick={close}>×</button>
          </div>
          {loadingInvoice ? (
            <div className="empty"><h2>جارٍ تحميل الفاتورة...</h2></div>
          ) : (
            <p className="form-error">{error || "تعذر تحميل الفاتورة المطلوبة."}</p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="modal-layer" onMouseDown={close}>
      <form className="student-modal payment-modal" dir="rtl" onMouseDown={(e) => e.stopPropagation()} onSubmit={handlePayment}>
        <div className="modal-head">
          <div>
            <h2>تسجيل الأداء وطباعة الفاتورة</h2>
            <p>{student.full_name} — الثمن الشهري {monthlyFee.toLocaleString("fr-FR")} د.م</p>
          </div>
          <button type="button" onClick={close} className="close">×</button>
        </div>

        {payments.length > 0 && (
          <div className="payment-history" style={{ marginBottom: 16 }}>
            <div className="payment-history-title">الأداءات المسجلة لهذا الشهر</div>
            {payments.map((payment) => (
              <div className="payment-history-row" key={payment.id}>
                <div>
                  <strong>{Number(payment.amount_paid).toLocaleString("fr-FR")} د.م</strong>
                  <span>تاريخ الأداء: {payment.payment_date}</span>
                </div>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <button type="button" className="secondary small" onClick={() => {
                    setEditingPaymentId(payment.id);
                    setEditingOriginalAmount(Number(payment.amount_paid));
                    setEditingCompensationType(payment.compensation_type_snapshot);
                    setEditingCompensationPercentage(payment.compensation_percentage_snapshot);
                    setAmountPaid(String(payment.amount_paid));
                    setIsPartialPayment(Number(payment.amount_paid) > 0 && Number(payment.amount_paid) < Number(student.monthly_fee ?? 0));
                    setPaymentDate(payment.payment_date);
                    setDeletePaymentId(null);
                    setDeleteReason("");
                    setError("");
                  }}>
                    تعديل
                  </button>
                  <button type="button" className="secondary small" onClick={() => {
                    setDeletePaymentId(payment.id);
                    setDeleteReason("");
                    setEditingPaymentId(null);
                    setEditingOriginalAmount(0);
                    setEditingCompensationType(null);
                    setEditingCompensationPercentage(null);
                    setError("");
                  }}>
                    حذف
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {deletePaymentId && (
          <div style={{ marginBottom: 16, padding: 14, borderRadius: 12, background: "#fff7ed", border: "1px solid #fed7aa" }}>
            <strong style={{ display: "block", marginBottom: 8 }}>حذف الأداء من النظام</strong>
            <p style={{ margin: "0 0 10px", color: "#7c2d12", fontSize: 12 }}>
              الأداء لن يظهر بعد الحذف في سجل الأداءات، وسيتم الاحتفاظ بسجل الحذف وسبب العملية.
            </p>
            <textarea
              value={deleteReason}
              onChange={(e) => setDeleteReason(e.target.value)}
              placeholder="سبب الحذف: مثال — خطأ في المبلغ / تسجيل مكرر / إلغاء الأداء..."
              rows={3}
              style={{ width: "100%", marginBottom: 10 }}
            />
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button type="button" className="secondary" onClick={() => { setDeletePaymentId(null); setDeleteReason(""); setError(""); }}>إلغاء</button>
              <button type="button" className="secondary" onClick={deletePayment} disabled={loading}>تأكيد حذف الأداء</button>
            </div>
          </div>
        )}

        <div className="form-grid">
          <label>
            اسم التلميذ
            <input value={student.full_name} readOnly aria-readonly="true" />
          </label>

          <label>
            الشهر الدراسي المؤدى عنه <span className="required">*</span>
            <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} required />
          </label>

          <label>
            تاريخ الأداء <span className="required">*</span>
            <input
              type="date"
              value={paymentDate}
              onChange={(e) => setPaymentDate(e.target.value)}
              required
            />
          </label>

          <label>
            المبلغ المؤدى بالدرهم <span className="required">*</span>
            <input
              type="number"
              min="0.01"
              step="0.01"
              inputMode="decimal"
              value={amountPaid}
              onChange={(e) => setAmountPaid(e.target.value)}
              required
            />
          </label>
        </div>

        <div style={{ marginBottom: 16, padding: 14, borderRadius: 12, background: "#f7f8fa", border: "1px solid #e7ebef" }}>
          <div style={{ display: "block", marginBottom: 8, fontWeight: 700 }}>هل الأداء جزئي؟</div>
          <div style={{ display: "flex", gap: 18, flexWrap: "wrap" }}>
            <label style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
              <input type="radio" name="partial-payment" checked={isPartialPayment === true} onChange={() => setIsPartialPayment(true)} />
              نعم
            </label>
            <label style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
              <input type="radio" name="partial-payment" checked={isPartialPayment === false} onChange={() => setIsPartialPayment(false)} />
              لا
            </label>
          </div>
        </div>

        <div className="payment-summary">
          <div><span>الثمن الشهري</span><strong>{monthlyFee.toLocaleString("fr-FR")} د.م</strong></div>
          <div><span>المؤدى سابقاً</span><strong>{loadingMonth ? "..." : `${basePaid.toLocaleString("fr-FR")} د.م`}</strong></div>
          <div><span>{editingPaymentId ? "المجموع بعد التعديل" : "المؤدى بعد العملية"}</span><strong>{totalPaid.toLocaleString("fr-FR")} د.م</strong></div>
          <div className="remaining"><span>الباقي</span><strong>{remaining.toLocaleString("fr-FR")} د.م</strong></div>
        </div>

        {editingPaymentId && (
          <button
            type="button"
            className="secondary"
            onClick={() => {
              setEditingPaymentId(null);
              setEditingOriginalAmount(0);
              setEditingCompensationType(null);
              setEditingCompensationPercentage(null);
              setIsPartialPayment(false);
              setAmountPaid(student.monthly_fee != null ? String(student.monthly_fee) : "");
              const now = new Date();
              setPaymentDate(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`);
              setError("");
            }}
          >
            إلغاء تعديل الفاتورة
          </button>
        )}

        {error && <p className="form-error">{error}</p>}

        <div className="modal-actions">
          <button type="button" className="secondary" onClick={close} disabled={loading}>إلغاء</button>
          <button type="submit" className="primary" disabled={loading}>
            {loading
              ? (editingPaymentId ? "جاري تعديل الأداء..." : "جاري تسجيل الأداء...")
              : (editingPaymentId ? "حفظ تعديل الفاتورة ثم طباعتها" : "تسجيل الأداء ثم طباعة الفاتورة")}
          </button>
        </div>
      </form>
    </div>
  );
}

function StudentPaymentHistoryModal({
  student,
  close,
}: {
  student: Student;
  close: () => void;
}) {
  const { lang } = useLanguage();
  const [rows, setRows] = useState<Array<{
    id: string;
    payment_month: string;
    payment_date: string | null;
    amount_due: number;
    amount_paid: number;
    remaining: number;
    status: string;
  }>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedInvoicePaymentId, setSelectedInvoicePaymentId] = useState<string | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void (async () => {
        const supabase = createClient();
        const { data, error: fetchError } = await supabase
          .from("payments")
          .select("id, payment_month, payment_date, amount_paid")
          .eq("student_id", student.id)
          .is("deleted_at", null)
          .order("payment_date", { ascending: true });

        if (fetchError) {
          setError("تعذر تحميل سجل الأداءات.");
          setRows([]);
          setLoading(false);
          return;
        }

        const duePerMonth = Number(student.monthly_fee ?? 0);
        const nextRows = (data ?? []).map((row) => {
          const paid = Number(row.amount_paid ?? 0);
          const status = paid >= duePerMonth ? "Payé" : paid > 0 ? "Partiel" : "Non payé";
          const remaining = Math.max(duePerMonth - paid, 0);
          return {
            id: String(row.id),
            payment_month: String(row.payment_month ?? ""),
            payment_date: String(row.payment_date ?? "—"),
            amount_due: duePerMonth,
            amount_paid: paid,
            remaining,
            status,
          };
        });

        setRows(nextRows);
        setLoading(false);
      })();
    }, 0);

    return () => window.clearTimeout(timer);
  }, [student.id, student.monthly_fee]);

  const totalPaid = rows.reduce((sum, row) => sum + row.amount_paid, 0);
  const totalRemaining = rows.reduce((sum, row) => sum + row.remaining, 0);

  const statusFromTotal =
    totalPaid <= 0 ? "Non payé" : totalPaid >= Number(student.monthly_fee ?? 0) * getCurrentSchoolYearMonthNumber(new Date()) ? "Payé" : "Partiel";

  return (
    <>
      <div className="modal-layer" onMouseDown={close}>
        <div className="student-modal" onMouseDown={(e) => e.stopPropagation()} style={{ width: 1080, maxWidth: "calc(100vw - 32px)" }}>
          <div className="modal-head">
            <div>
              <h2>سجل الأداءات</h2>
              <p>{student.full_name}</p>
            </div>
            <button type="button" className="close" onClick={close}>×</button>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 12, marginBottom: 18 }}>
            <div style={{ background: "#f7f8fa", borderRadius: 10, padding: 12 }}><small style={{ color: "#788292", display: "block", marginBottom: 4 }}>الاسم</small><strong>{student.full_name}</strong></div>
            <div style={{ background: "#f7f8fa", borderRadius: 10, padding: 12 }}><small style={{ color: "#788292", display: "block", marginBottom: 4 }}>المستوى</small><strong>{codeToLevel[student.level_code] ?? student.level_code}</strong></div>
            <div style={{ background: "#f7f8fa", borderRadius: 10, padding: 12 }}><small style={{ color: "#788292", display: "block", marginBottom: 4 }}>تاريخ التسجيل</small><strong>{formatDate(student.registration_date, lang)}</strong></div>
            <div style={{ background: "#f7f8fa", borderRadius: 10, padding: 12 }}><small style={{ color: "#788292", display: "block", marginBottom: 4 }}>الشهرية</small><strong>{Number(student.monthly_fee ?? 0).toLocaleString("fr-FR")} د.م</strong></div>
            <div style={{ background: "#f7f8fa", borderRadius: 10, padding: 12 }}><small style={{ color: "#788292", display: "block", marginBottom: 4 }}>الحالة الحالية</small><strong>{statusFromTotal}</strong></div>
            <div style={{ background: "#f7f8fa", borderRadius: 10, padding: 12 }}><small style={{ color: "#788292", display: "block", marginBottom: 4 }}>Reste actuel</small><strong>{Math.max(Number(student.monthly_fee ?? 0) * getCurrentSchoolYearMonthNumber(new Date()) - totalPaid, 0).toLocaleString("fr-FR")} د.م</strong></div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 12, marginBottom: 18 }}>
            <div style={{ background: "#eef8f4", borderRadius: 10, padding: 12 }}><small style={{ color: "#788292", display: "block", marginBottom: 4 }}>Total paid</small><strong>{totalPaid.toLocaleString("fr-FR")} د.م</strong></div>
            <div style={{ background: "#fff8e8", borderRadius: 10, padding: 12 }}><small style={{ color: "#788292", display: "block", marginBottom: 4 }}>Total remaining</small><strong>{totalRemaining.toLocaleString("fr-FR")} د.م</strong></div>
          </div>

          {loading ? (
            <div className="empty"><h2>جاري تحميل سجل الأداءات...</h2></div>
          ) : error ? (
            <p className="form-error">{error}</p>
          ) : rows.length === 0 ? (
            <div className="empty"><h2>لا توجد أداءات مسجلة لهذا التلميذ.</h2></div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>الشهر</th>
                    <th>تاريخ الأداء</th>
                    <th>المبلغ الواجب</th>
                    <th>المبلغ المؤدى</th>
                    <th>الباقي</th>
                    <th>الحالة</th>
                    <th>الفاتورة</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.id}>
                      <td>{row.payment_month ? new Date(`${row.payment_month}-01T00:00:00Z`).toLocaleDateString(lang === "ar" ? "ar-MA" : "fr-FR", { month: "long", year: "numeric", timeZone: "UTC" }) : "—"}</td>
                      <td>{row.payment_date && row.payment_date !== "—" ? formatDate(row.payment_date, lang) : "—"}</td>
                      <td>{row.amount_due.toLocaleString("fr-FR")} د.م</td>
                      <td>{row.amount_paid.toLocaleString("fr-FR")} د.م</td>
                      <td>{row.remaining.toLocaleString("fr-FR")} د.م</td>
                      <td><span className="payment">{row.status}</span></td>
                      <td>
                        {row.amount_paid > 0 ? (
                          <button type="button" className="secondary small" onClick={() => setSelectedInvoicePaymentId(row.id)}>
                            Voir facture
                          </button>
                        ) : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="modal-actions">
            <button type="button" className="secondary" onClick={close}>إغلاق</button>
          </div>
        </div>
      </div>

      {selectedInvoicePaymentId && (
        <PaymentInvoiceModal
          student={student}
          close={() => setSelectedInvoicePaymentId(null)}
          initialPaymentId={selectedInvoicePaymentId}
        />
      )}
    </>
  );
}

function StudentAttendanceHistory({
  student,
  close,
}: {
  student: Student;
  close: () => void;
}) {
  const [rows, setRows] = useState<Array<{ date: string; time: string; className: string; subjectName: string; teacherName: string; status: string; reason: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void (async () => {
        const supabase = createClient();
        const [recordsResult, classesResult, subjectsResult, teachersResult] = await Promise.all([
          supabase.from("attendance_session_records").select("status, absence_reason, attendance_sessions(session_date, start_time, end_time, room, class_id, subject_id, teacher_id)").eq("student_id", student.id).order("created_at", { ascending: false }),
          supabase.from("classes").select("id, name"),
          supabase.from("subjects").select("id, name"),
          supabase.from("teachers").select("id, full_name"),
        ]);
        if (recordsResult.error || classesResult.error || subjectsResult.error || teachersResult.error) {
          setError("تعذر تحميل تاريخ الحضور.");
          setLoading(false);
          return;
        }
        const classNames = Object.fromEntries((classesResult.data ?? []).map((item) => [String(item.id), item.name]));
        const subjectNames = Object.fromEntries((subjectsResult.data ?? []).map((item) => [String(item.id), item.name]));
        const teacherNames = Object.fromEntries((teachersResult.data ?? []).map((item) => [String(item.id), item.full_name]));
        setRows((recordsResult.data ?? []).map((record) => {
          const session = Array.isArray(record.attendance_sessions) ? record.attendance_sessions[0] : record.attendance_sessions;
          return {
            date: String(session?.session_date ?? "—"),
            time: `${String(session?.start_time ?? "").slice(0, 5)} - ${String(session?.end_time ?? "").slice(0, 5)}`,
            className: classNames[String(session?.class_id)] ?? "—",
            subjectName: subjectNames[String(session?.subject_id)] ?? "—",
            teacherName: teacherNames[String(session?.teacher_id)] ?? "—",
            status: ({ present: "حاضر", absent: "غائب", late: "متأخر", excused: "غائب بعذر" } as Record<string, string>)[String(record.status)] ?? String(record.status),
            reason: String(record.absence_reason ?? "—"),
          };
        }));
        setLoading(false);
      })();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [student.id]);

  return <div className="modal-layer" onMouseDown={close}><div className="student-modal" onMouseDown={(event) => event.stopPropagation()}><div className="modal-head"><div><h2>تاريخ حضور {student.full_name}</h2><p>السجل المرتبط بالحصص والجلسات.</p></div><button type="button" className="close" onClick={close}>×</button></div>{loading ? <div className="empty"><h2>جاري التحميل...</h2></div> : error ? <p className="form-error">{error}</p> : rows.length === 0 ? <div className="empty"><h2>لا يوجد تاريخ حضور مسجل.</h2></div> : <div className="table-wrap"><table><thead><tr><th>التاريخ</th><th>الوقت</th><th>القسم</th><th>المادة</th><th>الأستاذ</th><th>الحالة</th><th>سبب الغياب</th></tr></thead><tbody>{rows.map((row, index) => <tr key={`${row.date}-${row.time}-${index}`}><td>{row.date}</td><td>{row.time}</td><td>{row.className}</td><td>{row.subjectName}</td><td>{row.teacherName}</td><td>{row.status}</td><td>{row.reason}</td></tr>)}</tbody></table></div>}<div className="modal-actions"><button type="button" className="secondary" onClick={close}>إغلاق</button></div></div></div>;
}

function Students() {
  const { t, lang } = useLanguage();

  const [students, setStudents] = useState<Student[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [paymentHistoryStudent, setPaymentHistoryStudent] = useState<Student | null>(null);
  const [open, setOpen] = useState(false);
  const [editingStudent, setEditingStudent] = useState<Student | null>(null);
  const [q, setQ] = useState("");
  const [level, setLevel] = useState("all");
  const [status, setStatus] = useState("all");
  const [invoiceStudent, setInvoiceStudent] = useState<Student | null>(null);
  const [historyStudent, setHistoryStudent] = useState<Student | null>(null);

  async function loadStudents() {
    setLoading(true);
    setError("");

    const supabase = createClient();

    const { data, error: fetchError } = await supabase
      .from("students")
      .select("*")
      .eq("is_active", true)
      .order("created_at", { ascending: false });

    if (fetchError) {
      console.error(fetchError);
      setError("تعذر تحميل التلاميذ من قاعدة البيانات.");
      setLoading(false);
      return;
    }

    setStudents((data ?? []) as Student[]);
    setLoading(false);
  }

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadStudents();
    }, 0);

    return () => window.clearTimeout(timer);
  }, []);

  const rows = students.filter((student) => {
    const studentLevel =
      codeToLevel[student.level_code] ?? student.level_code;

    const searchValue = q.toLowerCase();

    const matchesSearch =
      student.full_name.toLowerCase().includes(searchValue) ||
      (student.phone ?? "").includes(q) ||
      (student.email ?? "").toLowerCase().includes(searchValue);

    const matchesLevel =
      level === "all" || studentLevel === level;

    const studentStatus = "مستحق";

    const matchesStatus =
      status === "all" || status === studentStatus;

    return (
      matchesSearch &&
      matchesLevel &&
      matchesStatus
    );
  });

  const headers = [
    "student",
    "phone",
    "level",
    "class",
    "monthlyFee",
    "registrationDate",
    "nextDue",
    "paymentStatus",
    "remaining",
    "actions",
  ] as const;

  function downloadStudentList() {
    const exportRows = rows.map((student) => ({
      "الاسم": student.full_name,
      "الهاتف": student.phone || "—",
      "المستوى": codeToLevel[student.level_code] ?? student.level_code,
      "القاعة": student.room || "—",
      "تاريخ التسجيل": student.registration_date ? formatDate(student.registration_date, lang) : "—",
      "الثمن الشهري": student.monthly_fee != null ? Number(student.monthly_fee).toLocaleString("fr-FR") : "—",
      "البريد الإلكتروني": student.email || "—",
      "اسم الوصي": student.guardian_name || "—",
      "هاتف الوصي": student.guardian_phone || "—",
      "ملاحظات": student.notes || "—",
      "الحالة": student.is_active ? "نشط" : "غير نشط",
    }));

    const worksheet = XLSX.utils.json_to_sheet(exportRows);
    worksheet["!cols"] = [
      { wch: 28 },
      { wch: 16 },
      { wch: 22 },
      { wch: 12 },
      { wch: 18 },
      { wch: 18 },
      { wch: 18 },
      { wch: 24 },
      { wch: 18 },
      { wch: 28 },
      { wch: 12 },
    ];

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Students");

    const fileDate = new Date().toISOString().slice(0, 10);
    XLSX.writeFile(workbook, `Student-List-${fileDate}.xlsx`);
  }

  function getStatusLabel(statusValue: string) {
    if (statusValue === "مؤدى") {
      return t("paid");
    }

    if (statusValue === "جزئي") {
      return t("partial");
    }

    if (statusValue === "متأخر") {
      return t("late");
    }

    return t("due");
  }

  async function deleteStudent(id: string) {
    const confirmed = window.confirm(
      "واش متأكد بغيتي تحيد هاد التلميذ؟"
    );

    if (!confirmed) {
      return;
    }

    const supabase = createClient();

    const { error: deleteError } = await supabase
      .from("students")
      .delete()
      .eq("id", id);

    if (deleteError) {
      console.error(deleteError);
      window.alert("وقع مشكل أثناء حذف التلميذ.");
      return;
    }

    setStudents((current) =>
      current.filter((student) => student.id !== id)
    );
  }

  return (
    <>
      <section className="welcome sub">
        <div>
          <p>
            {t("dashboard")} ← {t("students")}
          </p>

          <h1>{t("studentsTitle")}</h1>
          <h2>{t("studentsDesc")}</h2>
        </div>

        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <button
            className="primary"
            onClick={() => {
              setEditingStudent(null);
              setOpen(true);
            }}
          >
            <Icon name="plus" size={18} />
            {t("addStudent")}
          </button>

          <button
            type="button"
            className="secondary"
            onClick={downloadStudentList}
          >
            Download Student List
          </button>
        </div>
      </section>

      <section className="student-summary">
        <div className="stat-icon mint">
          <Icon name="users" />
        </div>

        <div>
          <span>{t("studentCount")}</span>
          <strong>{students.length}</strong>
        </div>
      </section>

      <section className="students-card">
        <div className="student-tools">
          <div className="student-search">
            <Icon name="search" />

            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={t("searchStudent")}
            />
          </div>

          <div className="filters">
            <select
              value={level}
              onChange={(e) => setLevel(e.target.value)}
            >
              <option value="all">
                {t("allLevels")}
              </option>

              {levels.map((x) => (
                <option key={x} value={x}>
                  {x}
                </option>
              ))}
            </select>

            <select
              value={status}
              onChange={(e) => setStatus(e.target.value)}
            >
              <option value="all">
                {t("allPayments")}
              </option>

              <option value="مؤدى">
                {t("paid")}
              </option>

              <option value="مستحق">
                {t("due")}
              </option>

              <option value="متأخر">
                {t("late")}
              </option>

              <option value="جزئي">
                {t("partial")}
              </option>
            </select>
          </div>
        </div>

        {loading ? (
          <div
            style={{
              padding: "40px",
              textAlign: "center",
            }}
          >
            جاري تحميل التلاميذ...
          </div>
        ) : error ? (
          <div
            style={{
              padding: "40px",
              textAlign: "center",
              color: "#b42318",
            }}
          >
            {error}
          </div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  {headers.map((x) => (
                    <th key={x}>{t(x)}</th>
                  ))}
                </tr>
              </thead>

              <tbody>
                {rows.length === 0 ? (
                  <tr>
                    <td
                      colSpan={headers.length}
                      style={{
                        textAlign: "center",
                        padding: "40px",
                      }}
                    >
                      {students.length === 0
                        ? "مازال ماكاين حتى تلميذ مسجل."
                        : "ما لقيناش تلميذ مطابق للبحث."}
                    </td>
                  </tr>
                ) : (
                  rows.map((student, index) => {
                    const studentLevel =
                      codeToLevel[student.level_code] ??
                      student.level_code;

                    const nextDue = getNextDueDate(
                      student.registration_date
                    );

                    const statusValue: string = "مستحق";

                    const statusLabel =
                      getStatusLabel(statusValue);

                    const tones = [
                      "green",
                      "blue",
                      "purple",
                      "orange",
                      "pink",
                    ];

                    return (
                      <tr key={student.id}>
                        <td>
                          <div className="student-name">
                            <Avatar
                              name={getInitials(
                                student.full_name
                              )}
                              tone={
                                tones[index % tones.length]
                              }
                            />

                            <strong>
                              {student.full_name}
                            </strong>
                          </div>
                        </td>

                        <td dir="ltr">
                          {student.phone || "—"}
                        </td>

                        <td>{studentLevel}</td>

                        <td>{student.room || "—"}</td>

                        <td>
                          {student.monthly_fee != null
                            ? `${Number(student.monthly_fee).toLocaleString("fr-FR")} د.م`
                            : "—"}
                        </td>

                        <td>
                          {formatDate(
                            student.registration_date,
                            lang
                          )}
                        </td>

                        <td className="next-due">
                          {nextDue
                            ? nextDue.toLocaleDateString(
                                lang === "ar"
                                  ? "ar-MA"
                                  : "fr-FR",
                                {
                                  day: "2-digit",
                                  month: "2-digit",
                                  year: "numeric",
                                  timeZone: "UTC",
                                }
                              )
                            : "—"}
                        </td>

                        <td>
                          <span className="payment">
                            {statusLabel}
                          </span>
                        </td>

                        <td>—</td>

                        <td>
                          <div className="row-actions">
                            <button
                              type="button"
                              onClick={() => setInvoiceStudent(student)}
                            >
                              فاتورة
                            </button>

                            <button
                              type="button"
                              onClick={() => setPaymentHistoryStudent(student)}
                            >
                              سجل الأداءات
                            </button>

                            <button
                              type="button"
                              onClick={() => setHistoryStudent(student)}
                            >
                              الحضور
                            </button>

                            <button
                              type="button"
                              onClick={async () => {
                                const guardianName = student.guardian_name?.trim() || "ولي الأمر";
                                const guardianPhone = student.guardian_phone || student.phone;
                                const monthKey = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}`;
                                const message = buildMonthlyReminderMessage({
                                  guardianName,
                                  studentName: student.full_name,
                                  month: monthKey,
                                });

                                const response = await fetch("/api/whatsapp/send", {
                                  method: "POST",
                                  headers: { "Content-Type": "application/json" },
                                  body: JSON.stringify({
                                    studentId: student.id,
                                    studentName: student.full_name,
                                    guardianName,
                                    guardianPhone,
                                    messageType: "monthly_reminder",
                                    messageContent: message,
                                    month: monthKey,
                                  }),
                                });

                                const result = await response.json().catch(() => ({}));
                                if (!response.ok) {
                                  throw new Error(result?.error || "تعذر إرسال رسالة واتساب.");
                                }

                                setError(result?.status === "duplicate" ? "تم إرسال هذا التنبيه بالفعل لهذا التلميذ وهذا الشهر." : "تم إرسال رسالة واتساب بنجاح.");
                              }}
                            >
                              واتساب
                            </button>

                            <button
                              type="button"
                              onClick={() => {
                                setEditingStudent(student);
                                setOpen(true);
                              }}
                            >
                              {t("edit")}
                            </button>

                            <button
                              type="button"
                              className="delete"
                              onClick={() =>
                                deleteStudent(student.id)
                              }
                            >
                              {t("delete")}
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {invoiceStudent && (
        <PaymentInvoiceModal
          student={invoiceStudent}
          close={() => setInvoiceStudent(null)}
        />
      )}

      {paymentHistoryStudent && (
        <StudentPaymentHistoryModal
          student={paymentHistoryStudent}
          close={() => setPaymentHistoryStudent(null)}
        />
      )}

      {historyStudent && (
        <StudentAttendanceHistory
          student={historyStudent}
          close={() => setHistoryStudent(null)}
        />
      )}

      {open && (
        <StudentModal
          student={editingStudent}
          close={() => {
            setOpen(false);
            setEditingStudent(null);
          }}
          onSaved={(student, isEdit) => {
            setStudents((current) =>
              isEdit
                ? current.map((item) =>
                    item.id === student.id ? student : item
                  )
                : [student, ...current]
            );
          }}
        />
      )}
    </>
  );
}


function Payments() {
  const [students, setStudents] = useState<Student[]>([]);
  const [payments, setPayments] = useState<
    { id: string; student_id: string; payment_month: string; amount_paid: number; payment_date: string }[]
  >([]);
  const [year, setYear] = useState(new Date().getFullYear());
  const [historyMonthNumber, setHistoryMonthNumber] = useState(new Date().getMonth() + 1);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [invoiceStudent, setInvoiceStudent] = useState<Student | null>(null);
  const [invoiceMonth, setInvoiceMonth] = useState<string | undefined>(undefined);
  const [expandedPaymentHistoryStudentId, setExpandedPaymentHistoryStudentId] = useState<string | null>(null);
  const [whatsAppHistoryStudent, setWhatsAppHistoryStudent] = useState<Student | null>(null);
  const [selectedWhatsAppPaymentId, setSelectedWhatsAppPaymentId] = useState("");
  const [whatsAppHistoryError, setWhatsAppHistoryError] = useState("");
  const [multiInvoiceStudent, setMultiInvoiceStudent] = useState<Student | null>(null);
  const [selectedMultiInvoiceIds, setSelectedMultiInvoiceIds] = useState<string[]>([]);
  const [multiInvoiceRecipientStudent, setMultiInvoiceRecipientStudent] = useState<Student | null>(null);
  const [multiInvoiceError, setMultiInvoiceError] = useState("");
  const [multiInvoiceJob, setMultiInvoiceJob] = useState<{
    student: Student;
    paymentIds: string[];
    recipientPhone: string;
    whatsappUrl: string;
    message: string;
    currentIndex: number;
    files: File[];
    phase: "generating" | "ready" | "error";
    error: string;
  } | null>(null);
  const generatedMultiInvoiceFilesRef = useRef<File[]>([]);
  const multiInvoiceWhatsAppWindowRef = useRef<Window | null>(null);
  const [historyInvoice, setHistoryInvoice] = useState<{
    student: Student;
    paymentId: string;
    action: "view" | "download" | "print" | "whatsapp";
  } | null>(null);

  async function loadPaymentsPage() {
    setLoading(true);
    setError("");
    const supabase = createClient();

    const [studentsResult, paymentsResult] = await Promise.all([
      supabase
        .from("students")
        .select("*")
        .order("full_name"),
      supabase
        .from("payments")
        .select("id, student_id, payment_month, amount_paid, payment_date")
        .is("deleted_at", null)
        .order("payment_month", { ascending: false }),
    ]);

    if (studentsResult.error) {
      console.error(studentsResult.error);
      setError("تعذر تحميل التلاميذ.");
    } else {
      setStudents((studentsResult.data ?? []) as Student[]);
    }

    if (paymentsResult.error) {
      console.error(paymentsResult.error);
      setError("تعذر تحميل الأداءات.");
    } else {
      setPayments(
        (paymentsResult.data ?? []).map((p) => ({
          id: String(p.id),
          student_id: String(p.student_id),
          payment_month: String(p.payment_month),
          amount_paid: Number(p.amount_paid ?? 0),
          payment_date: String(p.payment_date ?? ""),
        }))
      );
    }

    setLoading(false);
  }

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadPaymentsPage();
    }, 0);

    return () => window.clearTimeout(timer);
  }, []);

  const months = Array.from({ length: 12 }, (_, i) => i + 1);

  const monthNames = months.map((m) =>
    new Date(Date.UTC(year, m - 1, 1)).toLocaleDateString("ar-MA", {
      month: "short",
      timeZone: "UTC",
    })
  );

  function monthData(student: Student, monthNumber: number) {
    const key = `${year}-${String(monthNumber).padStart(2, "0")}`;

    const rows = payments.filter(
      (payment) =>
        payment.student_id === student.id &&
        payment.payment_month.startsWith(key)
    );

    const paid = rows.reduce(
      (sum, payment) => sum + Number(payment.amount_paid ?? 0),
      0
    );

    const fee = Number(student.monthly_fee ?? 0);

    return {
      rows,
      paid,
      fee,
      remaining: Math.max(fee - paid, 0),
      isPaid: fee > 0 && paid >= fee,
      isPartial: paid > 0 && paid < fee,
    };
  }

  const filteredStudents = students.filter(
    (student) => student.is_active && matchesStudentSearch(student, search)
  );
  const selectedHistoryMonth = `${year}-${String(historyMonthNumber).padStart(2, "0")}`;
  const historyPayments = payments.filter((payment) =>
    payment.payment_month.startsWith(selectedHistoryMonth)
  );
  const studentsById = new Map(students.map((student) => [student.id, student]));

  function openHistoricalInvoice(
    student: Student | undefined,
    paymentId: string,
    action: "view" | "download" | "print" | "whatsapp"
  ) {
    if (!student) return;
    setHistoryInvoice({ student, paymentId, action });
  }

  function openWhatsAppPaymentSelector(student: Student) {
    setSelectedWhatsAppPaymentId("");
    setWhatsAppHistoryError("");
    setWhatsAppHistoryStudent(student);
  }

  function confirmWhatsAppPaymentSelection() {
    if (!whatsAppHistoryStudent || !selectedWhatsAppPaymentId) {
      setWhatsAppHistoryError("يرجى اختيار أداء قبل المتابعة.");
      return;
    }

    const selectedPayment = payments.find(
      (payment) =>
        payment.id === selectedWhatsAppPaymentId &&
        payment.student_id === whatsAppHistoryStudent.id
    );
    const selectedMonth = selectedPayment?.payment_month.slice(0, 7) ?? "";
    if (!selectedPayment || !/^\d{4}-(0[1-9]|1[0-2])$/.test(selectedMonth)) {
      setWhatsAppHistoryError("تعذر تحديد شهر الأداء لهذا السجل بشكل موثوق.");
      return;
    }

    openHistoricalInvoice(whatsAppHistoryStudent, selectedPayment.id, "whatsapp");
    setWhatsAppHistoryStudent(null);
    setSelectedWhatsAppPaymentId("");
    setWhatsAppHistoryError("");
  }

  function getStudentRecordedPayments(studentId: string) {
    return payments
      .filter((payment) => payment.student_id === studentId)
      .sort((first, second) => {
        const dateOrder = second.payment_date.localeCompare(first.payment_date);
        return dateOrder || second.payment_month.localeCompare(first.payment_month);
      });
  }

  function getIdentifiableStudentPayments(studentId: string) {
    return getStudentRecordedPayments(studentId).filter((payment) =>
      /^\d{4}-(0[1-9]|1[0-2])(?:-\d{2})?$/.test(payment.payment_month)
    );
  }

  function openMultiInvoiceSelector(student: Student) {
    setMultiInvoiceStudent(student);
    setSelectedMultiInvoiceIds([]);
    setMultiInvoiceError("");
  }

  function requestMultiInvoiceRecipient() {
    if (!multiInvoiceStudent || selectedMultiInvoiceIds.length === 0) {
      setMultiInvoiceError("يرجى تحديد فاتورة واحدة على الأقل.");
      return;
    }

    setMultiInvoiceError("");
    setMultiInvoiceRecipientStudent(multiInvoiceStudent);
  }

  function startMultiInvoiceGeneration(recipientPhone: string) {
    const student = multiInvoiceRecipientStudent;
    if (!student) return;

    const selectedPayments = getIdentifiableStudentPayments(student.id)
      .filter((payment) => selectedMultiInvoiceIds.includes(payment.id));
    if (selectedPayments.length === 0) {
      setMultiInvoiceError("تعذر العثور على الفواتير المحددة ضمن أداءات هذا التلميذ.");
      setMultiInvoiceRecipientStudent(null);
      return;
    }

    const months = selectedPayments.map((payment) => {
      const monthKey = payment.payment_month.slice(0, 7);
      return new Date(`${monthKey}-01T00:00:00Z`).toLocaleDateString("ar-MA", {
        month: "long",
        year: "numeric",
        timeZone: "UTC",
      });
    });
    const message = buildMultipleInvoiceWhatsAppMessage({
      studentName: student.full_name,
      months,
    });
    const whatsappUrl = buildWhatsAppWebUrl(recipientPhone, message);
    if (!whatsappUrl) {
      setMultiInvoiceError("تعذر إعداد رابط WhatsApp. تحقق من رقم الهاتف.");
      setMultiInvoiceRecipientStudent(null);
      return;
    }

    generatedMultiInvoiceFilesRef.current = [];
    multiInvoiceWhatsAppWindowRef.current = window.open("about:blank", "_blank");
    setMultiInvoiceJob({
      student,
      paymentIds: selectedPayments.map((payment) => payment.id),
      recipientPhone,
      whatsappUrl,
      message,
      currentIndex: 0,
      files: [],
      phase: "generating",
      error: "",
    });
    setHistoryInvoice({
      student,
      paymentId: selectedPayments[0].id,
      action: "download",
    });
    setMultiInvoiceRecipientStudent(null);
    setMultiInvoiceStudent(null);
    setSelectedMultiInvoiceIds([]);
  }

  function completeMultiInvoiceDownload(succeeded: boolean) {
    const current = multiInvoiceJob;
    if (!current || current.phase !== "generating") return;
    if (!succeeded) {
      multiInvoiceWhatsAppWindowRef.current?.close();
      multiInvoiceWhatsAppWindowRef.current = null;
      setHistoryInvoice(null);
      setMultiInvoiceJob({
        ...current,
        phase: "error",
        error: "تعذر إنشاء إحدى الفواتير. توقف التنزيل عند هذه الفاتورة؛ راجع السجل وحاول مجدداً.",
      });
      return;
    }

    const nextIndex = current.currentIndex + 1;
    const files = [...generatedMultiInvoiceFilesRef.current];
    if (nextIndex < current.paymentIds.length) {
      setHistoryInvoice({
        student: current.student,
        paymentId: current.paymentIds[nextIndex],
        action: "download",
      });
      setMultiInvoiceJob({ ...current, currentIndex: nextIndex, files });
      return;
    }

    setHistoryInvoice(null);
    const popup = multiInvoiceWhatsAppWindowRef.current;
    if (popup) {
      popup.opener = null;
      popup.location.href = current.whatsappUrl;
    }
    multiInvoiceWhatsAppWindowRef.current = null;
    setMultiInvoiceJob({
      ...current,
      currentIndex: nextIndex,
      files,
      phase: "ready",
    });
  }

  async function shareGeneratedInvoices() {
    if (!multiInvoiceJob || multiInvoiceJob.files.length === 0) return;
    if (!navigator.canShare?.({ files: multiInvoiceJob.files })) {
      setMultiInvoiceJob((current) =>
        current ? { ...current, error: "المتصفح لا يدعم مشاركة عدة ملفات PDF. أرفق الملفات التي تم تنزيلها يدوياً في WhatsApp." } : current
      );
      return;
    }

    try {
      await navigator.share({
        files: multiInvoiceJob.files,
        title: `فواتير ${multiInvoiceJob.student.full_name}`,
        text: multiInvoiceJob.message,
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      console.error("Unable to share multiple invoice files:", error);
      setMultiInvoiceJob((current) =>
        current ? { ...current, error: "تعذرت مشاركة الملفات من المتصفح. يمكنك إرفاق ملفات PDF التي تم تنزيلها يدوياً." } : current
      );
    }
  }

  const getStudentPaymentSnapshot = (student: Student) => {
    const monthlyFee = Number(student.monthly_fee ?? 0);
    const totalPaid = getStudentSchoolYearPaidTotal(student.id, payments);
    const totalExpected = monthlyFee * getCurrentSchoolYearMonthNumber(new Date());
    const remaining = Math.max(totalExpected - totalPaid, 0);
    const status =
      totalPaid <= 0
        ? "Non payé"
        : totalPaid >= totalExpected
        ? "Payé"
        : "Partiel";

    return { monthlyFee, totalPaid, totalExpected, remaining, status };
  };

  const totalExpected = filteredStudents.reduce((sum, student) => {
    const monthlyFee = Number(student.monthly_fee ?? 0);
    return sum + monthlyFee * getCurrentSchoolYearMonthNumber(new Date());
  }, 0);

  const totalCollected = filteredStudents.reduce(
    (sum, student) => sum + getStudentSchoolYearPaidTotal(student.id, payments),
    0
  );

  return (
    <div dir="rtl">
      <section className="welcome sub">
        <div>
          <p>الرئيسية ← الأداءات</p>
          <h1>تتبع الأداءات</h1>
          <h2>
            جميع التلاميذ في صفحة واحدة، وكل شهر باين واش مخلص، جزئي أو باقي.
          </h2>
        </div>
      </section>

      <section className="content-card" style={{ marginBottom: 18 }}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(0, 1fr) 180px 180px 180px",
            gap: 12,
            alignItems: "end",
          }}
        >
          <label>
            البحث عن تلميذ
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="ابحث عن تلميذ..."
              style={{ width: "100%", marginTop: 7 }}
            />
          </label>

          <label>
            السنة
            <select
              value={year}
              onChange={(e) => setYear(Number(e.target.value))}
              style={{ width: "100%", marginTop: 7 }}
            >
              {[year - 2, year - 1, year, year + 1].map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </label>

          <label>
            الشهر
            <select
              value={historyMonthNumber}
              onChange={(e) => setHistoryMonthNumber(Number(e.target.value))}
              style={{ width: "100%", marginTop: 7 }}
            >
              {months.map((monthNumber, index) => (
                <option key={monthNumber} value={monthNumber}>
                  {monthNames[index]}
                </option>
              ))}
            </select>
          </label>

          <div
            style={{
              padding: "10px 12px",
              borderRadius: 12,
              background: "#f7f8fa",
            }}
          >
            <small style={{ color: "#788292" }}>عدد التلاميذ</small>
            <strong style={{ display: "block", fontSize: 20 }}>
              {filteredStudents.length}
            </strong>
          </div>
        </div>

        <div style={{ marginTop: 18 }}>
          {filteredStudents.length === 0 ? (
            <div
              style={{
                border: "1px dashed #dfe5ea",
                borderRadius: 12,
                padding: "28px 18px",
                textAlign: "center",
                color: "#5f6f7a",
                background: "#fafbfc",
              }}
            >
              لم يتم العثور على تلميذ.
            </div>
          ) : (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
                gap: 14,
              }}
            >
              {filteredStudents.map((student) => {
                const summary = getStudentPaymentSnapshot(student);
                const studentRecordedPayments = getStudentRecordedPayments(student.id);
                const studentLevel =
                  codeToLevel[student.level_code] ?? student.level_code ?? "—";

                return (
                  <div
                    key={student.id}
                    style={{
                      border: "1px solid #e7ebef",
                      borderRadius: 14,
                      padding: 14,
                      background: "#fff",
                      display: "flex",
                      flexDirection: "column",
                      gap: 12,
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: 10,
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <Avatar name={getInitials(student.full_name)} tone="green" />
                        <div>
                          <strong style={{ display: "block", fontSize: 15 }}>
                            {student.full_name}
                          </strong>
                          <small style={{ color: "#788292" }}>{studentLevel}</small>
                        </div>
                      </div>
                      <span
                        className={`payment ${
                          summary.status === "Payé"
                            ? "مؤدى"
                            : summary.status === "Partiel"
                            ? "مؤدى"
                            : "متأخر"
                        }`}
                        style={{
                          background:
                            summary.status === "Payé"
                              ? "#e7f6ef"
                              : summary.status === "Partiel"
                              ? "#fff8e8"
                              : "#fde9e8",
                          color:
                            summary.status === "Payé"
                              ? "#16816a"
                              : summary.status === "Partiel"
                              ? "#9a6700"
                              : "#c85c5a",
                        }}
                      >
                        {summary.status === "Payé"
                          ? "مؤدى"
                          : summary.status === "Partiel"
                            ? "جزئي"
                            : "غير مؤدى"}
                      </span>
                    </div>

                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                      <div style={{ background: "#f7f8fa", borderRadius: 10, padding: "10px 12px" }}>
                        <small style={{ color: "#788292", display: "block", marginBottom: 4 }}>
                        الهاتف
                        </small>
                        <strong>{student.phone || "—"}</strong>
                      </div>
                      <div style={{ background: "#f7f8fa", borderRadius: 10, padding: "10px 12px" }}>
                        <small style={{ color: "#788292", display: "block", marginBottom: 4 }}>
                          المستوى
                        </small>
                        <strong>{studentLevel}</strong>
                      </div>
                    </div>

                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                      <div>
                        <small style={{ color: "#788292", display: "block", marginBottom: 4 }}>
                          المؤدى
                        </small>
                        <strong>{summary.totalPaid.toLocaleString("fr-FR")} د.م</strong>
                      </div>
                      <div>
                        <small style={{ color: "#788292", display: "block", marginBottom: 4 }}>
                          الباقي
                        </small>
                        <strong>{summary.remaining.toLocaleString("fr-FR")} د.م</strong>
                      </div>
                    </div>

                    <button
                      type="button"
                      className="primary"
                      onClick={() => {
                        setInvoiceStudent(student);
                        setInvoiceMonth(`${year}-${String(new Date().getMonth() + 1).padStart(2, "0")}`);
                      }}
                      style={{
                        width: "100%",
                        marginTop: "auto",
                        fontSize: 14,
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: 8,
                      }}
                    >
                      💰 تسجيل الأداء
                    </button>

                    <button
                      type="button"
                      className="secondary"
                      aria-expanded={expandedPaymentHistoryStudentId === student.id}
                      onClick={() => setExpandedPaymentHistoryStudentId(
                        expandedPaymentHistoryStudentId === student.id ? null : student.id
                      )}
                      style={{ width: "100%" }}
                    >
                      سجل الأداءات والفواتير
                    </button>

                    {expandedPaymentHistoryStudentId === student.id && (
                      <div
                        style={{
                          width: "100%",
                          boxSizing: "border-box",
                          padding: 12,
                          border: "1px solid #e7ebef",
                          borderRadius: 10,
                          background: "#f8fafc",
                        }}
                      >
                        <strong style={{ display: "block", marginBottom: 10 }}>
                          سجل الأداءات المسجلة
                        </strong>
                        {studentRecordedPayments.length === 0 ? (
                          <p style={{ margin: 0, color: "#788292" }}>
                            لا توجد أداءات مسجلة لهذا التلميذ.
                          </p>
                        ) : (
                          <>
                            <button
                              type="button"
                              className="secondary small"
                              onClick={() => openWhatsAppPaymentSelector(student)}
                              style={{ width: "100%", marginBottom: 10 }}
                            >
                              إرسال الفاتورة عبر WhatsApp
                            </button>
                            <button
                              type="button"
                              className="secondary small"
                              onClick={() => openMultiInvoiceSelector(student)}
                              disabled={getIdentifiableStudentPayments(student.id).length === 0}
                              style={{ width: "100%", marginBottom: 10 }}
                            >
                              إرسال عدة فواتير عبر WhatsApp
                            </button>
                            <div style={{ display: "grid", gap: 10 }}>
                              {studentRecordedPayments.map((payment) => {
                                const paidMonthKey = payment.payment_month.slice(0, 7);
                                const hasValidMonth = /^\d{4}-(0[1-9]|1[0-2])$/.test(paidMonthKey);
                                const paidMonthLabel = hasValidMonth
                                  ? new Date(`${paidMonthKey}-01T00:00:00Z`).toLocaleDateString(
                                      "ar-MA",
                                      { month: "long", year: "numeric", timeZone: "UTC" }
                                    )
                                  : "الشهر غير متوفر";

                                return (
                                  <div
                                    key={payment.id}
                                    style={{
                                      display: "grid",
                                      gap: 6,
                                      padding: 10,
                                      borderRadius: 8,
                                      background: "#fff",
                                    }}
                                  >
                                    <strong>{paidMonthLabel}</strong>
                                    <span>
                                      تاريخ الأداء: {payment.payment_date
                                        ? formatDate(payment.payment_date, "ar")
                                        : "غير متوفر"}
                                    </span>
                                    <span>
                                      المبلغ المؤدى: {payment.amount_paid.toLocaleString("fr-FR")} درهم
                                    </span>
                                    <button
                                      type="button"
                                      className="secondary small"
                                      onClick={() => openHistoricalInvoice(student, payment.id, "download")}
                                    >
                                      تحميل الفاتورة PDF
                                    </button>
                                  </div>
                                );
                              })}
                            </div>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </section>

      {whatsAppHistoryStudent && (
        <div
          className="modal-layer"
          dir="rtl"
          onMouseDown={() => setWhatsAppHistoryStudent(null)}
        >
          <div
            className="student-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="whatsapp-payment-picker-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="modal-head">
              <div>
                <h2 id="whatsapp-payment-picker-title">اختيار الفاتورة لإرسالها</h2>
                <p>{whatsAppHistoryStudent.full_name}</p>
              </div>
              <button
                type="button"
                className="close"
                aria-label="إغلاق"
                onClick={() => setWhatsAppHistoryStudent(null)}
              >
                ×
              </button>
            </div>
            <div style={{ display: "grid", gap: 10, padding: 18 }}>
              {getStudentRecordedPayments(whatsAppHistoryStudent.id).map((payment) => {
                const paidMonthKey = payment.payment_month.slice(0, 7);
                const hasValidMonth = /^\d{4}-(0[1-9]|1[0-2])$/.test(paidMonthKey);
                const paidMonthLabel = hasValidMonth
                  ? new Date(`${paidMonthKey}-01T00:00:00Z`).toLocaleDateString(
                      "ar-MA",
                      { month: "long", year: "numeric", timeZone: "UTC" }
                    )
                  : "الشهر غير متوفر بشكل موثوق";

                return (
                  <label
                    key={payment.id}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "auto 1fr",
                      alignItems: "start",
                      gap: 10,
                      padding: 12,
                      border: "1px solid #e7ebef",
                      borderRadius: 9,
                      background: "#fff",
                      opacity: hasValidMonth ? 1 : 0.65,
                    }}
                  >
                    <input
                      type="radio"
                      name="whatsapp-history-payment"
                      value={payment.id}
                      checked={selectedWhatsAppPaymentId === payment.id}
                      disabled={!hasValidMonth}
                      onChange={() => {
                        setSelectedWhatsAppPaymentId(payment.id);
                        setWhatsAppHistoryError("");
                      }}
                    />
                    <span style={{ display: "grid", gap: 5 }}>
                      <strong>{paidMonthLabel}</strong>
                      <span>
                        تاريخ الأداء: {payment.payment_date
                          ? formatDate(payment.payment_date, "ar")
                          : "غير متوفر"}
                      </span>
                      <span>
                        المبلغ المؤدى: {payment.amount_paid.toLocaleString("fr-FR")} درهم
                      </span>
                    </span>
                  </label>
                );
              })}
              <p style={{ margin: 0, color: "#66746f", fontSize: 12 }}>
                سيتم تنزيل فاتورة الأداء المختار. أرفق ملف PDF يدوياً في واتساب قبل الضغط على إرسال.
              </p>
              {whatsAppHistoryError && (
                <p className="form-error" role="alert" style={{ margin: 0 }}>
                  {whatsAppHistoryError}
                </p>
              )}
            </div>
            <div className="modal-actions">
              <button
                type="button"
                className="secondary"
                onClick={() => setWhatsAppHistoryStudent(null)}
              >
                إلغاء
              </button>
              <button
                type="button"
                className="primary"
                disabled={!selectedWhatsAppPaymentId}
                onClick={confirmWhatsAppPaymentSelection}
              >
                تأكيد وإرسال عبر WhatsApp
              </button>
            </div>
          </div>
        </div>
      )}

      {multiInvoiceStudent && (() => {
        const eligiblePayments = getIdentifiableStudentPayments(multiInvoiceStudent.id);
        const selectedPayments = eligiblePayments.filter((payment) =>
          selectedMultiInvoiceIds.includes(payment.id)
        );
        const selectedAmount = selectedPayments.reduce((sum, payment) => {
          const amount = Number(payment.amount_paid);
          return sum + (Number.isFinite(amount) ? amount : 0);
        }, 0);

        return (
          <div
            className="modal-layer"
            dir="rtl"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) setMultiInvoiceStudent(null);
            }}
          >
            <div
              className="student-modal"
              role="dialog"
              aria-modal="true"
              aria-labelledby="multiple-invoice-picker-title"
              onMouseDown={(event) => event.stopPropagation()}
            >
              <div className="modal-head">
                <div>
                  <h2 id="multiple-invoice-picker-title">اختيار عدة فواتير</h2>
                  <p>{multiInvoiceStudent.full_name}</p>
                </div>
                <button type="button" className="close" aria-label="إغلاق" onClick={() => setMultiInvoiceStudent(null)}>×</button>
              </div>
              <div style={{ display: "grid", gap: 12, padding: 18, maxHeight: "55vh", overflowY: "auto" }}>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button
                    type="button"
                    className="secondary small"
                    onClick={() => setSelectedMultiInvoiceIds(eligiblePayments.map((payment) => payment.id))}
                  >
                    تحديد الكل
                  </button>
                  <button
                    type="button"
                    className="secondary small"
                    onClick={() => setSelectedMultiInvoiceIds([])}
                  >
                    إلغاء تحديد الكل
                  </button>
                </div>
                {eligiblePayments.length === 0 ? (
                  <p className="empty" style={{ margin: 0 }}>لا توجد أداءات مسجلة ذات شهر قابل للتحديد.</p>
                ) : (
                  eligiblePayments.map((payment) => {
                    const monthKey = payment.payment_month.slice(0, 7);
                    const monthLabel = new Date(`${monthKey}-01T00:00:00Z`).toLocaleDateString(
                      "ar-MA",
                      { month: "long", year: "numeric", timeZone: "UTC" }
                    );
                    return (
                      <label
                        key={payment.id}
                        style={{
                          display: "grid",
                          gridTemplateColumns: "auto 1fr",
                          alignItems: "start",
                          gap: 10,
                          padding: 12,
                          border: "1px solid #e7ebef",
                          borderRadius: 9,
                          background: "#fff",
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={selectedMultiInvoiceIds.includes(payment.id)}
                          onChange={(event) => setSelectedMultiInvoiceIds((current) =>
                            event.target.checked
                              ? [...current, payment.id]
                              : current.filter((paymentId) => paymentId !== payment.id)
                          )}
                        />
                        <span style={{ display: "grid", gap: 5 }}>
                          <strong>{monthLabel}</strong>
                          <span>
                            تاريخ الأداء: {payment.payment_date
                              ? formatDate(payment.payment_date, "ar")
                              : "غير متوفر"}
                          </span>
                          <span>المبلغ المؤدى: {payment.amount_paid.toLocaleString("fr-FR")} درهم</span>
                        </span>
                      </label>
                    );
                  })
                )}
                <div style={{ padding: 12, background: "#f7faf8", borderRadius: 9 }}>
                  <strong>عدد الفواتير المختارة: {selectedPayments.length}</strong>
                  <div style={{ marginTop: 5 }}>
                    مجموع المبالغ المؤداة: {selectedAmount.toLocaleString("fr-FR")} درهم
                  </div>
                </div>
                <p style={{ margin: 0, color: "#66746f", fontSize: 12 }}>
                  سيتم تنزيل ملف PDF مستقل لكل فاتورة مختارة، ثم فتح WhatsApp. أرفق جميع الملفات يدوياً قبل الضغط على إرسال.
                </p>
                {multiInvoiceError && <p className="form-error" role="alert" style={{ margin: 0 }}>{multiInvoiceError}</p>}
              </div>
              <div className="modal-actions">
                <button type="button" className="secondary" onClick={() => setMultiInvoiceStudent(null)}>إلغاء</button>
                <button
                  type="button"
                  className="primary"
                  disabled={selectedPayments.length === 0}
                  onClick={requestMultiInvoiceRecipient}
                >
                  متابعة إلى اختيار المستلم
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {multiInvoiceRecipientStudent && (
        <WhatsAppRecipientDialog
          studentName={multiInvoiceRecipientStudent.full_name}
          savedPhone={multiInvoiceRecipientStudent.guardian_phone || multiInvoiceRecipientStudent.phone}
          close={() => setMultiInvoiceRecipientStudent(null)}
          onConfirm={startMultiInvoiceGeneration}
        />
      )}

      {multiInvoiceJob && (
        <section className="content-card" dir="rtl" role="status" style={{ marginBottom: 16 }}>
          {multiInvoiceJob.phase === "generating" ? (
            <>
              <strong>
                جارٍ إنشاء وتنزيل الفاتورة {multiInvoiceJob.currentIndex + 1} من {multiInvoiceJob.paymentIds.length}...
              </strong>
              <p style={{ marginBottom: 0 }}>لا تغلق الصفحة حتى يكتمل إنشاء الملفات المحددة.</p>
            </>
          ) : multiInvoiceJob.phase === "ready" ? (
            <>
              <strong>تم تنزيل {multiInvoiceJob.files.length} فاتورة.</strong>
              <p>
                أُعد رابط WhatsApp لـ {multiInvoiceJob.recipientPhone} مع أسماء الأشهر المختارة.
                أرفق ملفات PDF يدوياً في المحادثة قبل الضغط على إرسال.
              </p>
              <a href={multiInvoiceJob.whatsappUrl} target="_blank" rel="noreferrer" className="secondary small">
                فتح WhatsApp Web
              </a>
              {typeof navigator !== "undefined" && navigator.canShare?.({ files: multiInvoiceJob.files }) && (
                <button type="button" className="secondary small" onClick={() => void shareGeneratedInvoices()}>
                  مشاركة ملفات PDF عبر التطبيقات المتاحة
                </button>
              )}
              {multiInvoiceJob.error && <p className="form-error" role="alert">{multiInvoiceJob.error}</p>}
              <button type="button" className="secondary small" onClick={() => setMultiInvoiceJob(null)}>
                إغلاق
              </button>
            </>
          ) : (
            <>
              <p className="form-error" role="alert">{multiInvoiceJob.error}</p>
              {multiInvoiceJob.files.length > 0 && (
                <p>تم تنزيل {multiInvoiceJob.files.length} ملف قبل التوقف. أرفقها يدوياً في WhatsApp.</p>
              )}
              <button type="button" className="secondary small" onClick={() => setMultiInvoiceJob(null)}>إغلاق</button>
            </>
          )}
        </section>
      )}

      {loading ? (
        <section className="content-card">
          <div className="empty">
            <h2>جاري تحميل الأداءات...</h2>
          </div>
        </section>
      ) : error ? (
        <section className="content-card">
          <div className="empty">
            <h2>{error}</h2>
          </div>
        </section>
      ) : (
        <>
          <section
            className="student-summary"
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
              gap: 16,
              marginBottom: 18,
            }}
          >
            <div>
              <span>عدد التلاميذ</span>
              <strong>{filteredStudents.length}</strong>
            </div>
            <div>
              <span>المداخيل الشهرية المتوقعة</span>
              <strong>
                {totalExpected.toLocaleString("fr-FR")} د.م
              </strong>
            </div>
            <div>
              <span>الأداءات المسجلة لسنة {year}</span>
              <strong>
                {totalCollected.toLocaleString("fr-FR")} د.م
              </strong>
            </div>
          </section>

          <section className="students-card" style={{ overflow: "hidden" }}>
            <div
              style={{
                padding: "16px 18px",
                borderBottom: "1px solid #e7ebef",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: 16,
              }}
            >
              <div>
                <strong style={{ fontSize: 18 }}>
                  سجل الأداءات — {year}
                </strong>
                <div style={{ marginTop: 5, color: "#788292", fontSize: 13 }}>
                  اضغط على أي شهر لتسجيل الأداء أو تعديله وفتح الفاتورة.
                </div>
              </div>

              <div style={{ display: "flex", gap: 10, fontSize: 12 }}>
                <span>🟢 مخلص</span>
                <span>🟡 جزئي</span>
                <span>⚪ غير مخلص</span>
              </div>
            </div>

            <div className="table-wrap" style={{ overflowX: "auto" }}>
              <table style={{ minWidth: 1180 }}>
                <thead>
                  <tr>
                    <th
                      style={{
                        position: "sticky",
                        right: 0,
                        background: "#fff",
                        zIndex: 2,
                        minWidth: 190,
                      }}
                    >
                      التلميذ
                    </th>
                    <th style={{ minWidth: 110 }}>الثمن</th>

                    {months.map((monthNumber, index) => (
                      <th
                        key={monthNumber}
                        style={{
                          textAlign: "center",
                          minWidth: 72,
                          textTransform: "capitalize",
                        }}
                      >
                        {monthNames[index]}
                      </th>
                    ))}
                  </tr>
                </thead>

                <tbody>
                  {filteredStudents.length === 0 ? (
                    <tr>
                      <td
                        colSpan={14}
                        style={{
                          textAlign: "center",
                          padding: 45,
                        }}
                      >
                        ما لقيناش تلميذ مطابق للبحث.
                      </td>
                    </tr>
                  ) : (
                    filteredStudents.map((student) => (
                      <tr key={student.id}>
                        <td
                          style={{
                            position: "sticky",
                            right: 0,
                            background: "#fff",
                            zIndex: 1,
                          }}
                        >
                          <div className="student-name">
                            <Avatar
                              name={getInitials(student.full_name)}
                              tone="green"
                            />
                            <div>
                              <strong>{student.full_name}</strong>
                              <small style={{ display: "block", color: "#788292" }}>
                                {codeToLevel[student.level_code] ??
                                  student.level_code}
                              </small>
                            </div>
                          </div>
                        </td>

                        <td>
                          <strong>
                            {Number(student.monthly_fee ?? 0).toLocaleString(
                              "fr-FR"
                            )}{" "}
                            د.م
                          </strong>
                        </td>

                        {months.map((monthNumber) => {
                          const d = monthData(student, monthNumber);
                          const monthKey = `${year}-${String(
                            monthNumber
                          ).padStart(2, "0")}`;

                          return (
                            <td
                              key={monthNumber}
                              style={{
                                padding: 6,
                                textAlign: "center",
                                background: d.isPaid
                                  ? "#eef8f4"
                                  : d.isPartial
                                  ? "#fff8e8"
                                  : "#fff",
                              }}
                            >
                              <button
                                type="button"
                                onClick={() => {
                                  setInvoiceStudent(student);
                                  setInvoiceMonth(monthKey);
                                }}
                                title={
                                  d.isPaid
                                    ? "مخلص — اضغط للتعديل أو الفاتورة"
                                    : d.isPartial
                                    ? "أداء جزئي — اضغط لإكمال أو تعديل الأداء"
                                    : "تسجيل الأداء"
                                }
                                style={{
                                  width: "100%",
                                  minHeight: 54,
                                  border: "1px solid #e7ebef",
                                  borderRadius: 10,
                                  background: "transparent",
                                  cursor: "pointer",
                                  padding: "6px 4px",
                                  color: d.isPaid
                                    ? "#0f7f68"
                                    : d.isPartial
                                    ? "#9a6700"
                                    : "#788292",
                                }}
                              >
                                <strong
                                  style={{
                                    display: "block",
                                    fontSize: 13,
                                  }}
                                >
                                  {d.isPaid
                                    ? "✓"
                                    : d.isPartial
                                    ? "جزئي"
                                    : "—"}
                                </strong>

                                <small
                                  style={{
                                    display: "block",
                                    marginTop: 3,
                                    fontSize: 10,
                                  }}
                                >
                                  {d.paid > 0
                                    ? `${d.paid.toLocaleString("fr-FR")} د.م`
                                    : "غير مخلص"}
                                </small>
                              </button>
                            </td>
                          );
                        })}
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <section className="students-card" style={{ marginTop: 18, overflow: "hidden" }} dir="rtl">
            <div style={{ padding: "16px 18px", borderBottom: "1px solid #e7ebef" }}>
              <strong style={{ fontSize: 18 }}>سجل الأداءات الشهرية</strong>
              <p style={{ margin: "6px 0 0", color: "#788292", fontSize: 13 }}>
                سجل الأداءات المسجلة لشهر {monthNames[historyMonthNumber - 1]} {year}. عرض الفاتورة أو تحميلها أو طباعتها لا يسجل أداءً جديداً.
              </p>
            </div>
            {historyPayments.length === 0 ? (
              <div className="empty"><h2>لا توجد أداءات مسجلة لهذا الشهر.</h2></div>
            ) : (
              <div className="table-wrap" style={{ overflowX: "auto" }}>
                <table style={{ minWidth: 900 }}>
                  <thead>
                    <tr>
                      <th>اسم التلميذ</th>
                      <th>تاريخ الأداء</th>
                      <th>الشهر المؤدى عنه</th>
                      <th>المبلغ المؤدى</th>
                      <th>إجراءات الفاتورة</th>
                    </tr>
                  </thead>
                  <tbody>
                    {historyPayments.map((payment) => {
                      const student = studentsById.get(payment.student_id);
                      const paymentMonthLabel = payment.payment_month
                        ? new Date(`${payment.payment_month.slice(0, 7)}-01T00:00:00Z`).toLocaleDateString(
                            "ar-MA",
                            { month: "long", year: "numeric", timeZone: "UTC" }
                          )
                        : "—";

                      return (
                        <tr key={payment.id}>
                          <td>{student?.full_name ?? "التلميذ غير متوفر"}</td>
                          <td>{payment.payment_date ? formatDate(payment.payment_date, "ar") : "—"}</td>
                          <td>{paymentMonthLabel}</td>
                          <td>{payment.amount_paid.toLocaleString("fr-FR")} د.م</td>
                          <td>
                            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                              <button
                                type="button"
                                className="secondary small"
                                disabled={!student}
                                onClick={() => openHistoricalInvoice(student, payment.id, "view")}
                              >
                                عرض الفاتورة
                              </button>
                              <button
                                type="button"
                                className="secondary small"
                                disabled={!student}
                                onClick={() => openHistoricalInvoice(student, payment.id, "download")}
                              >
                                تحميل PDF
                              </button>
                              <button
                                type="button"
                                className="secondary small"
                                disabled={!student}
                                onClick={() => openHistoricalInvoice(student, payment.id, "print")}
                              >
                                طباعة الفاتورة
                              </button>
                              <button
                                type="button"
                                className="secondary small"
                                disabled={!student}
                                onClick={() => openHistoricalInvoice(student, payment.id, "whatsapp")}
                              >
                                إرسال عبر WhatsApp
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}

      {invoiceStudent && (
        <PaymentInvoiceModal
          student={invoiceStudent}
          initialMonth={invoiceMonth}
          close={() => {
            setInvoiceStudent(null);
            setInvoiceMonth(undefined);
            loadPaymentsPage();
          }}
        />
      )}
      {historyInvoice && (
        <PaymentInvoiceModal
          key={historyInvoice.paymentId}
          student={historyInvoice.student}
          initialMonth={selectedHistoryMonth}
          initialPaymentId={historyInvoice.paymentId}
          initialAction={historyInvoice.action}
          whatsAppMessageLanguage={historyInvoice.action === "whatsapp" ? "ar" : undefined}
          onPdfGenerated={multiInvoiceJob?.phase === "generating"
            ? (file) => { generatedMultiInvoiceFilesRef.current.push(file); }
            : undefined}
          onInitialActionComplete={multiInvoiceJob?.phase === "generating"
            ? completeMultiInvoiceDownload
            : undefined}
          close={() => setHistoryInvoice(null)}
        />
      )}
    </div>
  );
}


type AttendanceStatus = "present" | "absent" | "late" | "excused";

type AttendanceRecord = {
  student_id: string;
  status: AttendanceStatus;
  note: string;
};

function Attendance() {
  const [students, setStudents] = useState<Student[]>([]);
  const [records, setRecords] = useState<Record<string, AttendanceRecord>>({});
  const [date, setDate] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  });
  const [search, setSearch] = useState("");
  const [room, setRoom] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | AttendanceStatus>("all");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function loadAttendance(selectedDate: string) {
    setLoading(true);
    setError("");
    const supabase = createClient();

    const [{ data: studentData, error: studentError }, { data: attendanceData, error: attendanceError }] =
      await Promise.all([
        supabase
          .from("students")
          .select("id, full_name, phone, email, level_code, registration_date, room, monthly_fee, guardian_name, guardian_phone, notes, is_active")
          .eq("is_active", true)
          .order("full_name", { ascending: true }),
        supabase
          .from("attendance")
          .select("student_id, status, note")
          .eq("attendance_date", selectedDate),
      ]);

    if (studentError) {
      setError(`خطأ في تحميل التلاميذ: ${studentError.message}`);
      setStudents([]);
      setLoading(false);
      return;
    }

    if (attendanceError) {
      setError(`خطأ في تحميل الحضور: ${attendanceError.message}`);
    }

    const loadedStudents = (studentData ?? []) as Student[];
    const next: Record<string, AttendanceRecord> = {};
    loadedStudents.forEach((student) => {
      next[student.id] = {
        student_id: student.id,
        status: "present",
        note: "",
      };
    });

    (attendanceData ?? []).forEach((row) => {
      const status = String(row.status) as AttendanceStatus;
      next[String(row.student_id)] = {
        student_id: String(row.student_id),
        status: ["present", "absent", "late", "excused"].includes(status)
          ? status
          : "present",
        note: String(row.note ?? ""),
      };
    });

    setStudents(loadedStudents);
    setRecords(next);
    setLoading(false);
  }

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadAttendance(date);
    }, 0);

    return () => window.clearTimeout(timer);
  }, [date]);

  function setStudentStatus(studentId: string, status: AttendanceStatus) {
    setRecords((current) => ({
      ...current,
      [studentId]: {
        ...(current[studentId] ?? { student_id: studentId, note: "" }),
        status,
      },
    }));
    setMessage("");
  }

  function setStudentNote(studentId: string, note: string) {
    setRecords((current) => ({
      ...current,
      [studentId]: {
        ...(current[studentId] ?? { student_id: studentId, status: "present" }),
        note,
      },
    }));
  }

  async function saveAttendance() {
    if (!date || students.length === 0) return;
    setSaving(true);
    setMessage("");
    setError("");
    const supabase = createClient();

    const rows = students.map((student) => ({
      student_id: student.id,
      attendance_date: date,
      status: records[student.id]?.status ?? "present",
      note: records[student.id]?.note?.trim() || null,
    }));

    const { error: saveError } = await supabase
      .from("attendance")
      .upsert(rows, { onConflict: "student_id,attendance_date" });

    if (saveError) {
      setError(`خطأ في حفظ الحضور: ${saveError.message}`);
    } else {
      setMessage(`تم حفظ الحضور بنجاح ليوم ${date}`);
      await loadAttendance(date);
    }
    setSaving(false);
  }

  const filteredStudents = students.filter((student) => {
    const q = search.trim().toLowerCase();
    const matchesSearch =
      !q ||
      student.full_name.toLowerCase().includes(q) ||
      String(student.phone ?? "").toLowerCase().includes(q);
    const matchesRoom = !room || student.room === room;
    const matchesStatus =
      statusFilter === "all" || records[student.id]?.status === statusFilter;
    return matchesSearch && matchesRoom && matchesStatus;
  });

  const counts = students.reduce(
    (acc, student) => {
      const status = records[student.id]?.status ?? "present";
      acc[status] += 1;
      return acc;
    },
    { present: 0, absent: 0, late: 0, excused: 0 } as Record<AttendanceStatus, number>
  );

  const statusLabels: Record<AttendanceStatus, string> = {
    present: "حاضر",
    absent: "غائب",
    late: "متأخر",
    excused: "غائب بعذر",
  };

  return (
    <>
      <section className="page-heading">
        <div>
          <div className="breadcrumbs">الرئيسية ← الحضور</div>
          <h1>تسجيل الحضور والغياب</h1>
          <p>سجل حالة كل تلميذ حسب اليوم، مع إمكانية البحث حسب الاسم أو القاعة.</p>
        </div>
        <button className="primary" type="button" onClick={saveAttendance} disabled={saving || loading || students.length === 0}>
          {saving ? "جاري الحفظ..." : "حفظ الحضور"}
        </button>
      </section>

      <section className="content-card" style={{ marginBottom: 18 }}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1.1fr 1fr 1fr 1fr",
            gap: 12,
            alignItems: "end",
          }}
        >
          <label>
            تاريخ الحضور
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              style={{ width: "100%", marginTop: 7 }}
            />
          </label>
          <label>
            بحث عن تلميذ
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="الاسم أو الهاتف"
              style={{ width: "100%", marginTop: 7 }}
            />
          </label>
          <label>
            القاعة
            <select value={room} onChange={(e) => setRoom(e.target.value)} style={{ width: "100%", marginTop: 7 }}>
              <option value="">كل القاعات</option>
              {rooms.map((item) => (
                <option key={item} value={item}>{item}</option>
              ))}
            </select>
          </label>
          <label>
            الحالة
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as "all" | AttendanceStatus)} style={{ width: "100%", marginTop: 7 }}>
              <option value="all">كل الحالات</option>
              <option value="present">حاضر</option>
              <option value="absent">غائب</option>
              <option value="late">متأخر</option>
              <option value="excused">غائب بعذر</option>
            </select>
          </label>
        </div>
      </section>

      <section
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
          gap: 14,
          marginBottom: 18,
        }}
      >
        {(["present", "absent", "late", "excused"] as AttendanceStatus[]).map((status) => (
          <button
            key={status}
            type="button"
            onClick={() => setStatusFilter(statusFilter === status ? "all" : status)}
            style={{
              textAlign: "right",
              border: statusFilter === status ? "2px solid #0f7f68" : "1px solid #e7ebef",
              borderRadius: 14,
              background: "#fff",
              padding: 16,
              cursor: "pointer",
            }}
          >
            <span style={{ color: "#788292", fontSize: 13 }}>{statusLabels[status]}</span>
            <strong style={{ display: "block", fontSize: 25, marginTop: 4 }}>{counts[status]}</strong>
          </button>
        ))}
      </section>

      {message && <div style={{ marginBottom: 14, padding: "11px 14px", borderRadius: 10, background: "#eef8f4", color: "#0f7f68" }}>{message}</div>}
      {error && <div style={{ marginBottom: 14, padding: "11px 14px", borderRadius: 10, background: "#fef3f2", color: "#b42318" }}>{error}</div>}

      <section className="students-card" style={{ overflow: "hidden" }}>
        <div style={{ padding: "16px 18px", borderBottom: "1px solid #e7ebef", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16 }}>
          <div>
            <strong style={{ fontSize: 18 }}>سجل الحضور — {date}</strong>
            <div style={{ marginTop: 5, color: "#788292", fontSize: 13 }}>
              عدد التلاميذ: {students.length} — المعروض: {filteredStudents.length}
            </div>
          </div>
          <button type="button" className="secondary" onClick={() => void loadAttendance(date)} disabled={loading || saving}>
            تحديث
          </button>
        </div>

        {loading ? (
          <div className="empty"><h2>جاري تحميل الحضور...</h2></div>
        ) : filteredStudents.length === 0 ? (
          <div className="empty"><h2>لا يوجد تلاميذ مطابقون للبحث</h2></div>
        ) : (
          <div className="table-wrap" style={{ overflowX: "auto" }}>
            <table style={{ minWidth: 980 }}>
              <thead>
                <tr>
                  <th style={{ minWidth: 240 }}>التلميذ</th>
                  <th style={{ minWidth: 120 }}>المستوى</th>
                  <th style={{ minWidth: 100 }}>القاعة</th>
                  <th style={{ minWidth: 360 }}>الحالة</th>
                  <th style={{ minWidth: 220 }}>ملاحظة</th>
                </tr>
              </thead>
              <tbody>
                {filteredStudents.map((student) => {
                  const current = records[student.id] ?? { student_id: student.id, status: "present" as AttendanceStatus, note: "" };
                  return (
                    <tr key={student.id}>
                      <td>
                        <div className="student-name">
                          <Avatar name={getInitials(student.full_name)} tone="green" />
                          <div>
                            <strong>{student.full_name}</strong>
                            <small style={{ display: "block", color: "#788292" }}>{student.phone ?? "بدون هاتف"}</small>
                          </div>
                        </div>
                      </td>
                      <td>{codeToLevel[student.level_code] ?? student.level_code}</td>
                      <td>{student.room ?? "—"}</td>
                      <td>
                        <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
                          {(["present", "absent", "late", "excused"] as AttendanceStatus[]).map((status) => (
                            <button
                              key={status}
                              type="button"
                              onClick={() => setStudentStatus(student.id, status)}
                              style={{
                                border: current.status === status ? "2px solid #0f7f68" : "1px solid #dfe5e9",
                                borderRadius: 9,
                                padding: "8px 12px",
                                background: current.status === status ? "#eef8f4" : "#fff",
                                cursor: "pointer",
                                fontWeight: current.status === status ? 700 : 500,
                              }}
                            >
                              {statusLabels[status]}
                            </button>
                          ))}
                        </div>
                      </td>
                      <td>
                        <input
                          value={current.note}
                          onChange={(e) => setStudentNote(student.id, e.target.value)}
                          placeholder="ملاحظة اختيارية"
                          style={{ width: "100%" }}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}

function AttendanceSessions() {
  const [legacyFallback, setLegacyFallback] = useState(false);
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [classes, setClasses] = useState<ClassGroup[]>([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [sessions, setSessions] = useState<AttendanceSessionRow[]>([]);
  const [schedules, setSchedules] = useState<ClassSchedule[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState("");
  const [students, setStudents] = useState<Student[]>([]);
  const [records, setRecords] = useState<Record<string, { status: AttendanceStatus; absence_reason: string }>>({});
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [classId, setClassId] = useState("");
  const [subjectId, setSubjectId] = useState("");
  const [teacherId, setTeacherId] = useState("");
  const [room, setRoom] = useState<string>(rooms[0]);
  const [startTime, setStartTime] = useState("09:00");
  const [endTime, setEndTime] = useState("10:30");
  const [rosterClassId, setRosterClassId] = useState("");
  const [rosterStudents, setRosterStudents] = useState<Student[]>([]);
  const [enrolledIds, setEnrolledIds] = useState<string[]>([]);
  const [rosterOpen, setRosterOpen] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [scheduleDay, setScheduleDay] = useState("1");

  async function loadBase(selectedDate: string) {
    setLoading(true);
    setError("");
    const supabase = createClient();
    const [classesResult, subjectsResult, teachersResult, sessionsResult, schedulesResult] = await Promise.all([
      supabase.from("classes").select("id, name, level_code, room, is_active").eq("is_active", true).order("name"),
      supabase.from("subjects").select("*").eq("is_active", true).order("name"),
      supabase.from("teachers").select("*").eq("is_active", true).order("full_name"),
      supabase.from("attendance_sessions").select("id, session_date, class_id, subject_id, teacher_id, room, start_time, end_time").eq("session_date", selectedDate).order("start_time"),
      supabase.from("class_schedules").select("id, class_id, subject_id, teacher_id, room, day_of_week, start_time, end_time, is_active").eq("is_active", true).order("day_of_week").order("start_time"),
    ]);

    const firstError = classesResult.error || subjectsResult.error || teachersResult.error || sessionsResult.error || schedulesResult.error;
    if (firstError) {
      setError(`خطأ في تحميل الحصص: ${firstError.message}`);
      if (firstError.code === "PGRST205" || firstError.code === "42P01") {
        setLegacyFallback(true);
      }
      setLoading(false);
      return;
    }

    setClasses((classesResult.data ?? []) as ClassGroup[]);
    setSubjects((subjectsResult.data ?? []) as Subject[]);
    setTeachers((teachersResult.data ?? []) as Teacher[]);
    setSchedules((schedulesResult.data ?? []) as ClassSchedule[]);
    const nextSessions = (sessionsResult.data ?? []) as AttendanceSessionRow[];
    setSessions(nextSessions);
    setSelectedSessionId((current) => nextSessions.some((session) => session.id === current) ? current : nextSessions[0]?.id ?? "");
    setLoading(false);
  }

  useEffect(() => {
    const timer = window.setTimeout(() => void loadBase(date), 0);
    return () => window.clearTimeout(timer);
  }, [date]);

  const selectedSession = sessions.find((session) => session.id === selectedSessionId) ?? null;

  async function loadSessionStudents(session: AttendanceSessionRow | null) {
    if (!session) {
      setStudents([]);
      setRecords({});
      return;
    }

    setLoading(true);
    const supabase = createClient();
    const { data: enrollmentData, error: enrollmentError } = await supabase
      .from("class_enrollments")
      .select("student_id")
      .eq("class_id", session.class_id)
      .eq("is_active", true);
    if (enrollmentError) {
      setError(`خطأ في تحميل تلاميذ القسم: ${enrollmentError.message}`);
      setLoading(false);
      return;
    }

    const ids = (enrollmentData ?? []).map((row) => String(row.student_id));
    if (ids.length === 0) {
      setStudents([]);
      setRecords({});
      setLoading(false);
      return;
    }

    const [{ data: studentData, error: studentError }, { data: recordData, error: recordError }] = await Promise.all([
      supabase.from("students").select("*").in("id", ids).eq("is_active", true).order("full_name"),
      supabase.from("attendance_session_records").select("student_id, status, absence_reason").eq("session_id", session.id),
    ]);
    if (studentError || recordError) {
      setError(`خطأ في تحميل سجل الحضور: ${(studentError || recordError)?.message}`);
    } else {
      setStudents((studentData ?? []) as Student[]);
      const nextRecords: Record<string, { status: AttendanceStatus; absence_reason: string }> = {};
      (studentData ?? []).forEach((student) => { nextRecords[String(student.id)] = { status: "present", absence_reason: "" }; });
      (recordData ?? []).forEach((record) => { nextRecords[String(record.student_id)] = { status: record.status as AttendanceStatus, absence_reason: String(record.absence_reason ?? "") }; });
      setRecords(nextRecords);
    }
    setLoading(false);
  }

  useEffect(() => {
    const timer = window.setTimeout(() => void loadSessionStudents(selectedSession), 0);
    return () => window.clearTimeout(timer);
  }, [selectedSession, selectedSessionId, sessions]);

  async function createSession(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!classId || !subjectId || !teacherId || !startTime || !endTime) { setError("المرجو إكمال معلومات الحصة."); return; }
    setSaving(true);
    setError("");
    const { data, error: saveError } = await createClient().from("attendance_sessions").insert({ session_date: date, class_id: classId, subject_id: subjectId, teacher_id: teacherId, room, start_time: startTime, end_time: endTime }).select("id, session_date, class_id, subject_id, teacher_id, room, start_time, end_time").single();
    if (saveError) setError(`خطأ في إنشاء الحصة: ${saveError.message}`);
    else if (data) { setSessions((current) => [...current, data as AttendanceSessionRow].sort((left, right) => left.start_time.localeCompare(right.start_time))); setSelectedSessionId(data.id); setCreateOpen(false); setMessage("تم إنشاء الحصة بنجاح."); }
    setSaving(false);
  }

  async function createSchedule(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!classId || !subjectId || !teacherId || !startTime || !endTime) { setError("المرجو إكمال معلومات البرنامج."); return; }
    setSaving(true);
    setError("");
    const { data, error: saveError } = await createClient().from("class_schedules").insert({ class_id: classId, subject_id: subjectId, teacher_id: teacherId, room, day_of_week: Number(scheduleDay), start_time: startTime, end_time: endTime, is_active: true }).select("id, class_id, subject_id, teacher_id, room, day_of_week, start_time, end_time, is_active").single();
    if (saveError) setError(`خطأ في حفظ البرنامج: ${saveError.message}`);
    else if (data) { setSchedules((current) => [...current, data as ClassSchedule]); setScheduleOpen(false); setMessage("تم حفظ البرنامج الأسبوعي."); }
    setSaving(false);
  }

  async function loadRoster(nextClassId: string) {
    setRosterClassId(nextClassId);
    if (!nextClassId) { setRosterStudents([]); setEnrolledIds([]); return; }
    const supabase = createClient();
    const [{ data: allStudents }, { data: enrollments }] = await Promise.all([
      supabase.from("students").select("*").eq("is_active", true).order("full_name"),
      supabase.from("class_enrollments").select("student_id").eq("class_id", nextClassId).eq("is_active", true),
    ]);
    setRosterStudents((allStudents ?? []) as Student[]);
    setEnrolledIds((enrollments ?? []).map((row) => String(row.student_id)));
  }

  async function saveRoster() {
    if (!rosterClassId) return;
    setSaving(true);
    const supabase = createClient();
    const { error: deactivateError } = await supabase.from("class_enrollments").update({ is_active: false }).eq("class_id", rosterClassId).eq("is_active", true);
    const rows = enrolledIds.map((studentId) => ({ class_id: rosterClassId, student_id: studentId, is_active: true }));
    const { error: upsertError } = rows.length ? await supabase.from("class_enrollments").upsert(rows, { onConflict: "class_id,student_id" }) : { error: null };
    if (deactivateError || upsertError) setError(`خطأ في حفظ تلاميذ القسم: ${(deactivateError || upsertError)?.message}`);
    else setMessage("تم حفظ تلاميذ القسم.");
    setSaving(false);
  }

  async function saveAttendance() {
    if (!selectedSession || students.length === 0) return;
    const invalid = students.find((student) => ["absent", "excused"].includes(records[student.id]?.status) && !records[student.id]?.absence_reason.trim());
    if (invalid) { setError(`المرجو إدخال سبب غياب ${invalid.full_name}.`); return; }
    setSaving(true);
    setError("");
    const rows = students.map((student) => ({ session_id: selectedSession.id, student_id: student.id, status: records[student.id]?.status ?? "present", absence_reason: records[student.id]?.absence_reason.trim() || null }));
    const { error: saveError } = await createClient().from("attendance_session_records").upsert(rows, { onConflict: "session_id,student_id" });
    if (saveError) setError(`خطأ في حفظ الحضور: ${saveError.message}`);
    else setMessage("تم حفظ الحضور بنجاح.");
    setSaving(false);
  }

  const className = (id: string) => classes.find((item) => item.id === id)?.name ?? "—";
  const subjectName = (id: string) => subjects.find((item) => item.id === id)?.name ?? "—";
  const teacherName = (id: string) => teachers.find((item) => item.id === id)?.full_name ?? "—";
  const visibleStudents = students.filter((student) => !search.trim() || student.full_name.toLowerCase().includes(search.trim().toLowerCase()));
  const statusLabels: Record<AttendanceStatus, string> = { present: "حاضر", absent: "غائب", late: "متأخر", excused: "غائب بعذر" };

  if (legacyFallback) {
    return <Attendance />;
  }

  return (
    <>
      <section className="page-heading"><div><div className="breadcrumbs">الرئيسية ← الحضور</div><h1>الحضور حسب الحصة</h1><p>اختر التاريخ والحصة، ثم سجل حضور تلاميذ القسم بسرعة.</p></div><div style={{ display: "flex", gap: 8 }}><button className="secondary" type="button" onClick={() => setScheduleOpen((value) => !value)}>البرنامج الأسبوعي</button><button className="secondary" type="button" onClick={() => setRosterOpen((value) => !value)}>تلاميذ الأقسام</button><button className="primary" type="button" onClick={() => setCreateOpen((value) => !value)}>إضافة حصة</button></div></section>
      <section className="content-card" style={{ marginBottom: 18 }}><div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 12, alignItems: "end" }}><label>التاريخ<input type="date" value={date} onChange={(event) => setDate(event.target.value)} style={{ width: "100%", marginTop: 7 }} /></label><label>الحصة / الجلسة<select value={selectedSessionId} onChange={(event) => setSelectedSessionId(event.target.value)} style={{ width: "100%", marginTop: 7 }}><option value="">اختيار الحصة</option>{sessions.map((session) => <option key={session.id} value={session.id}>{session.start_time.slice(0, 5)} - {session.end_time.slice(0, 5)} · {className(session.class_id)} · {subjectName(session.subject_id)}</option>)}</select></label></div>{selectedSession && <div style={{ marginTop: 14, padding: 14, borderRadius: 10, background: "#f4f9f7", display: "flex", gap: 18, flexWrap: "wrap", color: "#52645d" }}><span>الوقت: <strong>{selectedSession.start_time.slice(0, 5)} - {selectedSession.end_time.slice(0, 5)}</strong></span><span>القسم: <strong>{className(selectedSession.class_id)}</strong></span><span>المادة: <strong>{subjectName(selectedSession.subject_id)}</strong></span><span>الأستاذ: <strong>{teacherName(selectedSession.teacher_id)}</strong></span><span>القاعة: <strong>{selectedSession.room}</strong></span></div>}</section>
      {createOpen && <section className="content-card" style={{ marginBottom: 18 }}><form className="form-grid" onSubmit={createSession}><label>القسم<select value={classId} onChange={(event) => setClassId(event.target.value)} required><option value="">اختيار القسم</option>{classes.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label>المادة<select value={subjectId} onChange={(event) => setSubjectId(event.target.value)} required><option value="">اختيار المادة</option>{subjects.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label>الأستاذ<select value={teacherId} onChange={(event) => setTeacherId(event.target.value)} required><option value="">اختيار الأستاذ</option>{teachers.map((item) => <option key={item.id} value={item.id}>{item.full_name}</option>)}</select></label><label>القاعة<select value={room} onChange={(event) => setRoom(event.target.value)}>{rooms.map((item) => <option key={item} value={item}>{item}</option>)}</select></label><label>وقت البداية<input type="time" value={startTime} onChange={(event) => setStartTime(event.target.value)} required /></label><label>وقت النهاية<input type="time" value={endTime} onChange={(event) => setEndTime(event.target.value)} required /></label><div className="form-wide"><button className="primary" type="submit" disabled={saving}>{saving ? "جاري الإنشاء..." : "إنشاء الحصة"}</button></div></form></section>}
      {scheduleOpen && <section className="content-card" style={{ marginBottom: 18 }}><form className="form-grid" onSubmit={createSchedule}><label>اليوم<select value={scheduleDay} onChange={(event) => setScheduleDay(event.target.value)}><option value="0">الأحد</option><option value="1">الإثنين</option><option value="2">الثلاثاء</option><option value="3">الأربعاء</option><option value="4">الخميس</option><option value="5">الجمعة</option><option value="6">السبت</option></select></label><label>القسم<select value={classId} onChange={(event) => setClassId(event.target.value)} required><option value="">اختيار القسم</option>{classes.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label>المادة<select value={subjectId} onChange={(event) => setSubjectId(event.target.value)} required><option value="">اختيار المادة</option>{subjects.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label>الأستاذ<select value={teacherId} onChange={(event) => setTeacherId(event.target.value)} required><option value="">اختيار الأستاذ</option>{teachers.map((item) => <option key={item.id} value={item.id}>{item.full_name}</option>)}</select></label><label>القاعة<select value={room} onChange={(event) => setRoom(event.target.value)}>{rooms.map((item) => <option key={item} value={item}>{item}</option>)}</select></label><label>البداية<input type="time" value={startTime} onChange={(event) => setStartTime(event.target.value)} required /></label><label>النهاية<input type="time" value={endTime} onChange={(event) => setEndTime(event.target.value)} required /></label><div className="form-wide"><button className="primary" type="submit" disabled={saving}>حفظ البرنامج</button></div></form><div className="table-wrap" style={{ marginTop: 16 }}><table><thead><tr><th>اليوم</th><th>القسم</th><th>المادة</th><th>الأستاذ</th><th>الوقت</th><th>القاعة</th></tr></thead><tbody>{schedules.map((schedule) => <tr key={schedule.id}><td>{["الأحد", "الإثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"][schedule.day_of_week]}</td><td>{className(schedule.class_id)}</td><td>{subjectName(schedule.subject_id)}</td><td>{teacherName(schedule.teacher_id)}</td><td>{schedule.start_time.slice(0, 5)} - {schedule.end_time.slice(0, 5)}</td><td>{schedule.room}</td></tr>)}</tbody></table></div></section>}
      {rosterOpen && <section className="content-card" style={{ marginBottom: 18 }}><h2>تلاميذ الأقسام</h2><label>القسم<select value={rosterClassId} onChange={(event) => void loadRoster(event.target.value)}><option value="">اختيار القسم</option>{classes.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>{rosterClassId && <><div style={{ display: "grid", gap: 8, maxHeight: 240, overflow: "auto", margin: "14px 0" }}>{rosterStudents.map((student) => <label key={student.id} style={{ display: "flex", gap: 8, alignItems: "center" }}><input type="checkbox" checked={enrolledIds.includes(student.id)} onChange={(event) => setEnrolledIds((current) => event.target.checked ? [...current, student.id] : current.filter((id) => id !== student.id))} />{student.full_name}</label>)}</div><button type="button" className="primary" onClick={() => void saveRoster()} disabled={saving}>حفظ تلاميذ القسم</button></>}</section>}
      {message && <div style={{ marginBottom: 14, padding: "11px 14px", borderRadius: 10, background: "#eef8f4", color: "#0f7f68" }}>{message}</div>}{error && <div style={{ marginBottom: 14, padding: "11px 14px", borderRadius: 10, background: "#fef3f2", color: "#b42318" }}>{error}</div>}
      {!selectedSessionId ? <section className="content-card"><div className="empty"><h2>{sessions.length ? "اختيار الحصة لبدء تسجيل الحضور" : "لا توجد حصة لهذا التاريخ"}</h2><p>أنشئ حصة جديدة أو اختر تاريخاً آخر.</p></div></section> : <section className="students-card"><div style={{ padding: "16px 18px", borderBottom: "1px solid #e7ebef", display: "flex", justifyContent: "space-between", gap: 16, alignItems: "center" }}><div><strong style={{ fontSize: 18 }}>سجل الحضور</strong><div style={{ marginTop: 5, color: "#788292", fontSize: 13 }}>المعروض: {visibleStudents.length} من {students.length}</div></div><div style={{ display: "flex", gap: 8 }}><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="بحث عن تلميذ" /><button type="button" className="secondary" onClick={() => setRecords((current) => Object.fromEntries(students.map((student) => [student.id, { status: "present", absence_reason: current[student.id]?.absence_reason ?? "" }])))}>تحديد الكل حاضر</button><button type="button" className="primary" onClick={() => void saveAttendance()} disabled={saving || loading}>{saving ? "جاري الحفظ..." : "حفظ الحضور"}</button></div></div>{loading ? <div className="empty"><h2>جاري التحميل...</h2></div> : visibleStudents.length === 0 ? <div className="empty"><h2>لا يوجد تلاميذ مسجلون في هذا القسم</h2><p>افتح تلاميذ الأقسام وأضف التلاميذ إلى القسم.</p></div> : <div className="table-wrap"><table><thead><tr><th>التلميذ</th><th>الحالة</th><th>سبب الغياب / ملاحظة</th></tr></thead><tbody>{visibleStudents.map((student) => { const current = records[student.id] ?? { status: "present" as AttendanceStatus, absence_reason: "" }; return <tr key={student.id}><td><div className="student-name"><Avatar name={getInitials(student.full_name)} tone="green" /><strong>{student.full_name}</strong></div></td><td><div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>{(Object.keys(statusLabels) as AttendanceStatus[]).map((status) => <button key={status} type="button" onClick={() => setRecords((state) => ({ ...state, [student.id]: { ...current, status }}))} style={{ border: current.status === status ? "2px solid #0f7f68" : "1px solid #dfe5e9", borderRadius: 9, padding: "8px 11px", background: current.status === status ? "#eef8f4" : "#fff" }}>{statusLabels[status]}</button>)}</div></td><td><input value={current.absence_reason} onChange={(event) => setRecords((state) => ({ ...state, [student.id]: { ...current, absence_reason: event.target.value }}))} placeholder={current.status === "present" ? "ملاحظة اختيارية" : "سبب الغياب"} required={current.status === "absent"} style={{ width: "100%" }} /></td></tr>; })}</tbody></table></div>}</section>}
    </>
  );
}

function Teachers() {
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<Teacher | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [specialty, setSpecialty] = useState("");
  const [salary, setSalary] = useState("");
  const [notes, setNotes] = useState("");
  const [active, setActive] = useState(true);
  const [defaultCompensationType, setDefaultCompensationType] = useState<"percentage" | "fixed_monthly_salary">("percentage");
  const [defaultPercentage, setDefaultPercentage] = useState("50");

  async function loadTeachers() {
    const supabase = createClient();
    setLoading(true);
    setError("");
    const { data, error: fetchError } = await supabase
      .from("teachers")
      .select("*")
      .order("full_name", { ascending: true });

    if (fetchError) {
      setError("تعذر تحميل الأساتذة. تأكد من تطبيق migration الخاصة بالأساتذة.");
    } else {
      setTeachers((data ?? []) as Teacher[]);
    }
    setLoading(false);
  }

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadTeachers();
    }, 0);

    return () => window.clearTimeout(timer);
  }, []);

  function openTeacherModal(teacher?: Teacher) {
    setEditing(teacher ?? null);
    setName(teacher?.full_name ?? "");
    setPhone(teacher?.phone ?? "");
    setEmail(teacher?.email ?? "");
    setSpecialty(teacher?.specialty ?? "");
    setSalary(teacher?.monthly_salary == null ? "" : String(teacher.monthly_salary));
    setNotes(teacher?.notes ?? "");
    setActive(teacher?.is_active ?? true);
    setDefaultCompensationType(teacher?.default_compensation_type ?? "percentage");
    setDefaultPercentage(String(teacher?.default_compensation_percentage ?? 50));
    setError("");
    setModalOpen(true);
  }

  async function saveTeacher(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedName = name.trim();
    const salaryValue = salary.trim() ? Number(salary) : null;
    const defaultPercentageValue = Number(defaultPercentage);

    if (!trimmedName) {
      setError("المرجو إدخال اسم الأستاذ.");
      return;
    }

    if (salaryValue !== null && (!Number.isFinite(salaryValue) || salaryValue < 0)) {
      setError("الأجرة الشهرية يجب أن تكون مبلغاً صحيحاً أو فارغة.");
      return;
    }

    if (defaultCompensationType === "percentage" && (!Number.isFinite(defaultPercentageValue) || defaultPercentageValue < 0 || defaultPercentageValue > 100)) {
      setError("النسبة الافتراضية يجب أن تكون بين 0 و100.");
      return;
    }

    const payload = {
      full_name: trimmedName,
      phone: phone.trim() || null,
      email: email.trim() || null,
      specialty: specialty.trim() || null,
      monthly_salary: salaryValue,
      default_compensation_type: defaultCompensationType,
      default_compensation_percentage: defaultCompensationType === "percentage" ? defaultPercentageValue : 0,
      notes: notes.trim() || null,
      is_active: active,
    };
    const supabase = createClient();
    const query = editing
      ? supabase.from("teachers").update(payload).eq("id", editing.id).select("*").single()
      : supabase.from("teachers").insert(payload).select("*").single();
    const { data, error: saveError } = await query;

    if (saveError) {
      console.error("Teacher save Supabase error", {
        code: saveError.code,
        message: saveError.message,
        details: saveError.details,
        hint: saveError.hint,
      });
      setError(saveError.code === "23505" ? "هذا البريد الإلكتروني مسجل من قبل." : "وقع مشكل أثناء حفظ بيانات الأستاذ.");
      return;
    }

    if (data) {
      setTeachers((current) => editing
        ? current.map((item) => item.id === editing.id ? data as Teacher : item)
        : [...current, data as Teacher].sort((left, right) => left.full_name.localeCompare(right.full_name, "ar")));
    }
    setModalOpen(false);
  }

  async function deactivateTeacher(teacher: Teacher) {
    if (!window.confirm("سيتم تعطيل الأستاذ بدل حذفه نهائياً حفاظاً على أي مراجع مستقبلية. هل تريد المتابعة؟")) return;
    const { data, error: updateError } = await createClient()
      .from("teachers")
      .update({ is_active: false })
      .eq("id", teacher.id)
      .select("*")
      .single();

    if (updateError) {
      window.alert("وقع مشكل أثناء تعطيل الأستاذ.");
      return;
    }

    if (data) setTeachers((current) => current.map((item) => item.id === teacher.id ? data as Teacher : item));
  }

  const rows = teachers.filter((teacher) => {
    const query = search.trim().toLowerCase();
    const matchesSearch = !query || [teacher.full_name, teacher.phone, teacher.email, teacher.specialty]
      .some((value) => (value ?? "").toLowerCase().includes(query));
    const isActive = teacher.is_active !== false;
    const matchesStatus = status === "all" || (status === "active" ? isActive : !isActive);
    return matchesSearch && matchesStatus;
  });

  return (
    <>
      <section className="welcome sub">
        <div><p>الرئيسية ← الأساتذة</p><h1>الأساتذة</h1><h2>إدارة ومتابعة الأساتذة العاملين بالمركز.</h2></div>
        <button className="primary" type="button" onClick={() => openTeacherModal()}><Icon name="plus" size={18} />إضافة أستاذ</button>
      </section>
      <section className="student-summary"><div className="stat-icon mint"><Icon name="user" /></div><div><span>إجمالي الأساتذة</span><strong>{teachers.length}</strong></div></section>
      <section className="students-card">
        <div className="student-tools"><div className="student-search"><Icon name="search" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="ابحث بالاسم أو الهاتف أو التخصص..." /></div><div className="filters"><select value={status} onChange={(event) => setStatus(event.target.value)}><option value="all">كل الحالات</option><option value="active">نشطون</option><option value="inactive">غير نشطين</option></select></div></div>
        {loading ? <div className="empty"><h2>جاري تحميل الأساتذة...</h2></div> : error && teachers.length === 0 ? <div className="empty"><h2>{error}</h2></div> : <div className="table-wrap"><table><thead><tr><th>الأستاذ</th><th>الهاتف</th><th>البريد الإلكتروني</th><th>التخصص</th><th>الأجرة الشهرية</th><th>الحالة</th><th>الإجراءات</th></tr></thead><tbody>{rows.length === 0 ? <tr><td colSpan={7} style={{ textAlign: "center", padding: 40 }}>لا توجد نتائج مطابقة.</td></tr> : rows.map((teacher) => <tr key={teacher.id}><td><div className="student-name"><Avatar name={getInitials(teacher.full_name)} tone="green" /><strong>{teacher.full_name}</strong></div></td><td dir="ltr">{teacher.phone || "—"}</td><td dir="ltr">{teacher.email || "—"}</td><td>{teacher.specialty || "—"}</td><td>{teacher.monthly_salary == null ? "—" : `${teacher.monthly_salary.toLocaleString("fr-FR")} د.م`}</td><td><span className={`payment ${teacher.is_active ? "مؤدى" : "غير-مؤدى"}`}>{teacher.is_active ? "نشط" : "غير نشط"}</span></td><td><div className="row-actions"><button type="button" onClick={() => openTeacherModal(teacher)}>تعديل</button>{teacher.is_active && <button type="button" className="delete" onClick={() => deactivateTeacher(teacher)}>تعطيل</button>}</div></td></tr>)}</tbody></table></div>}
      </section>
      {modalOpen && <div className="modal-layer" onMouseDown={() => setModalOpen(false)}><form className="student-modal" onMouseDown={(event) => event.stopPropagation()} onSubmit={saveTeacher}><div className="modal-head"><div><h2>{editing ? "تعديل بيانات الأستاذ" : "إضافة أستاذ جديد"}</h2><p>أدخل المعلومات الأساسية للأستاذ.</p></div><button type="button" className="close" onClick={() => setModalOpen(false)}>×</button></div><div className="form-grid"><label>الاسم الكامل<input value={name} onChange={(event) => setName(event.target.value)} required /></label><label>رقم الهاتف<input value={phone} onChange={(event) => setPhone(event.target.value)} /></label><label>البريد الإلكتروني<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} /></label><label>التخصص<input value={specialty} onChange={(event) => setSpecialty(event.target.value)} /></label><label>الأجرة الشهرية (د.م)<input type="number" min="0" step="0.01" value={salary} onChange={(event) => setSalary(event.target.value)} /></label><div className="form-wide" style={{ background: "#f7faf8", border: "1px solid #e4eee9", borderRadius: 10, padding: 14 }}><strong style={{ display: "block", marginBottom: 9 }}>الإعداد الافتراضي لأجر الأستاذ</strong><div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}><label><input type="radio" checked={defaultCompensationType === "percentage"} onChange={() => setDefaultCompensationType("percentage")} /> نسبة</label><label><input type="radio" checked={defaultCompensationType === "fixed_monthly_salary"} onChange={() => setDefaultCompensationType("fixed_monthly_salary")} /> راتب ثابت</label></div>{defaultCompensationType === "percentage" && <select value={["50", "60", "70"].includes(defaultPercentage) ? defaultPercentage : "custom"} onChange={(event) => { if (event.target.value !== "custom") setDefaultPercentage(event.target.value); }} style={{ marginTop: 9 }}><option value="50">50%</option><option value="60">60%</option><option value="70">70%</option><option value="custom">نسبة مخصصة</option></select>}{defaultCompensationType === "percentage" && !["50", "60", "70"].includes(defaultPercentage) && <input type="number" min="0" max="100" step="0.01" value={defaultPercentage} onChange={(event) => setDefaultPercentage(event.target.value)} placeholder="مثال: 65" style={{ marginTop: 8 }} />}</div><label className="form-wide">ملاحظات<textarea value={notes} onChange={(event) => setNotes(event.target.value)} /></label><label className="form-wide"><input type="checkbox" checked={active} onChange={(event) => setActive(event.target.checked)} /> الأستاذ نشط</label></div>{error && <p className="form-error">{error}</p>}<div className="modal-actions"><button type="button" className="secondary" onClick={() => setModalOpen(false)}>إلغاء</button><button type="submit" className="primary">حفظ الأستاذ</button></div></form></div>}
    </>
  );
}

function Classes() {
  const [classes, setClasses] = useState<ClassGroup[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [name, setName] = useState("");
  const [levelCode, setLevelCode] = useState(levels[0] ? levelToCode[levels[0]] : "primary_1");
  const [room, setRoom] = useState<string>(rooms[0]);
  const [saving, setSaving] = useState(false);

  async function loadClasses() {
    setLoading(true);
    const { data, error: fetchError } = await createClient().from("classes").select("id, name, level_code, room, is_active").order("name");
    if (fetchError) setError(`تعذر تحميل الأقسام: ${fetchError.message}`);
    else setClasses((data ?? []) as ClassGroup[]);
    setLoading(false);
  }

  useEffect(() => {
    const timer = window.setTimeout(() => void loadClasses(), 0);
    return () => window.clearTimeout(timer);
  }, []);

  async function addClass(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!name.trim()) { setError("المرجو إدخال اسم القسم."); return; }
    setSaving(true);
    const { data, error: saveError } = await createClient().from("classes").insert({ name: name.trim(), level_code: levelCode, room, is_active: true }).select("id, name, level_code, room, is_active").single();
    if (saveError) setError(`تعذر إضافة القسم: ${saveError.message}`);
    else if (data) { setClasses((current) => [...current, data as ClassGroup].sort((left, right) => left.name.localeCompare(right.name, "ar"))); setName(""); }
    setSaving(false);
  }

  const rows = classes.filter((item) => item.name.toLowerCase().includes(search.trim().toLowerCase()));
  return <><section className="welcome sub"><div><p>الرئيسية ← الأقسام</p><h1>الأقسام والمجموعات</h1><h2>أنشئ المجموعات واربطها بالحصص وتلاميذها.</h2></div></section><section className="content-card" style={{ marginBottom: 18 }}><form className="form-grid" onSubmit={addClass}><label>اسم القسم<input value={name} onChange={(event) => setName(event.target.value)} placeholder="مثال: المجموعة A" required /></label><label>المستوى<select value={levelCode} onChange={(event) => setLevelCode(event.target.value)}>{levels.map((level) => <option key={level} value={levelToCode[level]}>{level}</option>)}</select></label><label>القاعة<select value={room} onChange={(event) => setRoom(event.target.value)}>{rooms.map((item) => <option key={item} value={item}>{item}</option>)}</select></label><div className="form-wide"><button className="primary" type="submit" disabled={saving}>{saving ? "جاري الحفظ..." : "إضافة قسم"}</button></div></form>{error && <p className="form-error">{error}</p>}</section><section className="students-card"><div className="student-tools"><div className="student-search"><Icon name="search" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="ابحث عن قسم..." /></div><strong>{classes.length} قسم</strong></div>{loading ? <div className="empty"><h2>جاري التحميل...</h2></div> : <div className="table-wrap"><table><thead><tr><th>القسم</th><th>المستوى</th><th>القاعة</th><th>الحالة</th></tr></thead><tbody>{rows.length === 0 ? <tr><td colSpan={4} style={{ textAlign: "center", padding: 40 }}>لا توجد أقسام.</td></tr> : rows.map((item) => <tr key={item.id}><td><strong>{item.name}</strong></td><td>{codeToLevel[item.level_code ?? ""] ?? item.level_code ?? "—"}</td><td>{item.room ?? "—"}</td><td>{item.is_active ? "نشط" : "غير نشط"}</td></tr>)}</tbody></table></div>}</section></>;
}

function Subjects() {
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<Subject | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [description, setDescription] = useState("");
  const [active, setActive] = useState(true);

  async function loadSubjects() {
    const supabase = createClient();
    setLoading(true);
    const { data, error: fetchError } = await supabase.from("subjects").select("*").order("name");
    if (fetchError) setError("تعذر تحميل المواد. تأكد من تطبيق migration الخاصة بالمواد.");
    else setSubjects((data ?? []) as Subject[]);
    setLoading(false);
  }

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadSubjects();
    }, 0);

    return () => window.clearTimeout(timer);
  }, []);

  function openModal(subject?: Subject) {
    setEditing(subject ?? null);
    setName(subject?.name ?? "");
    setCode(subject?.code ?? "");
    setDescription(subject?.description ?? "");
    setActive(subject?.is_active ?? true);
    setError("");
    setModalOpen(true);
  }

  async function saveSubject(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!name.trim()) { setError("المرجو إدخال اسم المادة."); return; }
    const supabase = createClient();
    const payload = { name: name.trim(), code: code.trim() || null, description: description.trim() || null, is_active: active };
    const query = editing
      ? supabase.from("subjects").update(payload).eq("id", editing.id).select("*").single()
      : supabase.from("subjects").insert(payload).select("*").single();
    const { data, error: saveError } = await query;
    if (saveError) { setError(saveError.code === "23505" ? "هذه المادة موجودة من قبل." : "وقع مشكل أثناء حفظ المادة."); return; }
    if (data) setSubjects((current) => editing ? current.map((item) => item.id === editing.id ? data as Subject : item) : [...current, data as Subject]);
    setModalOpen(false);
  }

  async function deactivateSubject(subject: Subject) {
    if (!window.confirm("سيتم تعطيل المادة بدل حذفها نهائياً حفاظاً على المراجع. هل تريد المتابعة؟")) return;
    const { data, error: updateError } = await createClient().from("subjects").update({ is_active: false }).eq("id", subject.id).select("*").single();
    if (updateError) { window.alert("وقع مشكل أثناء تعطيل المادة."); return; }
    if (data) setSubjects((current) => current.map((item) => item.id === subject.id ? data as Subject : item));
  }

  const rows = subjects.filter((subject) => {
    const query = search.trim().toLowerCase();
    return (!query || subject.name.toLowerCase().includes(query) || (subject.code ?? "").toLowerCase().includes(query)) &&
      (status === "all" || (status === "active" ? subject.is_active : !subject.is_active));
  });

  return (
    <>
      <section className="welcome sub"><div><p>الرئيسية ← المواد</p><h1>المواد الدراسية</h1><h2>إدارة المواد المعتمدة في المركز.</h2></div><button className="primary" type="button" onClick={() => openModal()}><Icon name="plus" size={18} />إضافة مادة</button></section>
      <section className="student-summary"><div className="stat-icon mint"><Icon name="book" /></div><div><span>إجمالي المواد</span><strong>{subjects.length}</strong></div></section>
      <section className="students-card"><div className="student-tools"><div className="student-search"><Icon name="search" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="ابحث باسم المادة أو رمزها..." /></div><div className="filters"><select value={status} onChange={(event) => setStatus(event.target.value)}><option value="all">كل الحالات</option><option value="active">نشطة</option><option value="inactive">غير نشطة</option></select></div></div>
        {loading ? <div className="empty"><h2>جاري تحميل المواد...</h2></div> : error && subjects.length === 0 ? <div className="empty"><h2>{error}</h2></div> : <div className="table-wrap"><table><thead><tr><th>المادة</th><th>الرمز</th><th>الوصف</th><th>الحالة</th><th>الإجراءات</th></tr></thead><tbody>{rows.length === 0 ? <tr><td colSpan={5} style={{ textAlign: "center", padding: 40 }}>لا توجد مواد مطابقة.</td></tr> : rows.map((subject) => <tr key={subject.id}><td><strong>{subject.name}</strong></td><td>{subject.code || "—"}</td><td>{subject.description || "—"}</td><td><span className={`payment ${subject.is_active ? "مؤدى" : "غير-مؤدى"}`}>{subject.is_active ? "نشطة" : "غير نشطة"}</span></td><td><div className="row-actions"><button type="button" onClick={() => openModal(subject)}>تعديل</button>{subject.is_active && <button type="button" className="delete" onClick={() => deactivateSubject(subject)}>تعطيل</button>}</div></td></tr>)}</tbody></table></div>}
      </section>
      {modalOpen && <div className="modal-layer" onMouseDown={() => setModalOpen(false)}><form className="student-modal" onMouseDown={(event) => event.stopPropagation()} onSubmit={saveSubject}><div className="modal-head"><div><h2>{editing ? "تعديل المادة" : "إضافة مادة جديدة"}</h2><p>أدخل معلومات المادة الدراسية.</p></div><button type="button" className="close" onClick={() => setModalOpen(false)}>×</button></div><div className="form-grid"><label>اسم المادة<input value={name} onChange={(event) => setName(event.target.value)} required /></label><label>رمز المادة<input value={code} onChange={(event) => setCode(event.target.value)} /></label><label className="form-wide">الوصف<textarea value={description} onChange={(event) => setDescription(event.target.value)} /></label><label className="form-wide"><input type="checkbox" checked={active} onChange={(event) => setActive(event.target.checked)} /> المادة نشطة</label></div>{error && <p className="form-error">{error}</p>}<div className="modal-actions"><button type="button" className="secondary" onClick={() => setModalOpen(false)}>إلغاء</button><button type="submit" className="primary">حفظ المادة</button></div></form></div>}
    </>
  );
}

type TeacherSalaryPayment = {
  id: string;
  teacher_id: string;
  salary_month: string;
  expected_amount: number;
  paid_amount: number;
  payment_status: "paid" | "partial" | "unpaid";
  payment_date: string | null;
  notes: string | null;
};

function Expenses() {
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [salaries, setSalaries] = useState<TeacherSalaryPayment[]>([]);
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [teacherId, setTeacherId] = useState("");
  const [paidAmount, setPaidAmount] = useState("");
  const [paymentDate, setPaymentDate] = useState("");
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function loadSalaryData(selectedMonth: string) {
    setLoading(true);
    const supabase = createClient();
    const [teachersResult, salariesResult] = await Promise.all([
      supabase.from("teachers").select("*").eq("is_active", true).order("full_name"),
      supabase.from("teacher_salary_payments").select("*").eq("salary_month", `${selectedMonth}-01`).order("created_at", { ascending: false }),
    ]);
    if (teachersResult.error || salariesResult.error) {
      setError("تعذر تحميل أجور الأساتذة. تأكد من تطبيق migration الخاصة بالتعويضات.");
    } else {
      setTeachers((teachersResult.data ?? []) as Teacher[]);
      setSalaries((salariesResult.data ?? []) as TeacherSalaryPayment[]);
    }
    setLoading(false);
  }

  useEffect(() => {
    const timer = window.setTimeout(() => void loadSalaryData(month), 0);
    return () => window.clearTimeout(timer);
  }, [month]);

  const selectedTeacher = teachers.find((teacher) => teacher.id === teacherId);
  const expectedAmount = Number(selectedTeacher?.monthly_salary ?? 0);
  const paidValue = Number(paidAmount || 0);
  const paymentStatus: TeacherSalaryPayment["payment_status"] = paidValue <= 0 ? "unpaid" : paidValue >= expectedAmount ? "paid" : "partial";

  async function saveSalary(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!teacherId) { setError("المرجو اختيار الأستاذ."); return; }
    if (!Number.isFinite(paidValue) || paidValue < 0) { setError("المبلغ المؤدى يجب أن يكون أكبر أو يساوي 0."); return; }
    setSaving(true);
    setError("");
    const { error: saveError } = await createClient().from("teacher_salary_payments").upsert({
      teacher_id: teacherId,
      salary_month: `${month}-01`,
      expected_amount: expectedAmount,
      paid_amount: paidValue,
      payment_status: paymentStatus,
      payment_date: paymentDate || null,
      notes: notes.trim() || null,
    }, { onConflict: "teacher_id,salary_month" });
    if (saveError) setError("وقع مشكل أثناء حفظ أجرة الأستاذ.");
    else { setTeacherId(""); setPaidAmount(""); setPaymentDate(""); setNotes(""); await loadSalaryData(month); }
    setSaving(false);
  }

  return (
    <>
      <section className="welcome sub"><div><p>الرئيسية ← المصاريف</p><h1>أجور الأساتذة</h1><h2>تسجيل وتتبع الأجور الشهرية دون تكرار.</h2></div></section>
      <section className="content-card" style={{ marginBottom: 18 }}><form className="form-grid" onSubmit={saveSalary}><label>الشهر<input type="month" value={month} onChange={(event) => setMonth(event.target.value)} required /></label><label>الأستاذ<select value={teacherId} onChange={(event) => { setTeacherId(event.target.value); const teacher = teachers.find((item) => item.id === event.target.value); setPaidAmount(teacher?.monthly_salary == null ? "" : String(teacher.monthly_salary)); }} required><option value="">اختيار الأستاذ</option>{teachers.map((teacher) => <option key={teacher.id} value={teacher.id}>{teacher.full_name}</option>)}</select></label><label>الأجر الشهري المتوقع<input value={selectedTeacher ? `${expectedAmount.toLocaleString("fr-FR")} د.م` : "—"} readOnly /></label><label>المبلغ المؤدى<input type="number" min="0" step="0.01" value={paidAmount} onChange={(event) => setPaidAmount(event.target.value)} /></label><label>تاريخ الأداء<input type="date" value={paymentDate} onChange={(event) => setPaymentDate(event.target.value)} /></label><label className="form-wide">ملاحظات<textarea value={notes} onChange={(event) => setNotes(event.target.value)} /></label><div className="form-wide" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}><span>الحالة: <strong>{paymentStatus === "paid" ? "مؤدى" : paymentStatus === "partial" ? "جزئي" : "غير مؤدى"}</strong></span><button className="primary" type="submit" disabled={saving}>{saving ? "جاري الحفظ..." : "حفظ الأجرة"}</button></div></form>{error && <p className="form-error">{error}</p>}</section>
      <section className="students-card"><div className="student-tools"><strong>سجل أجور شهر {month}</strong></div>{loading ? <div className="empty"><h2>جاري التحميل...</h2></div> : <div className="table-wrap"><table><thead><tr><th>الأستاذ</th><th>المتوقع</th><th>المؤدى</th><th>الحالة</th><th>تاريخ الأداء</th><th>ملاحظات</th></tr></thead><tbody>{salaries.length === 0 ? <tr><td colSpan={6} style={{ textAlign: "center", padding: 40 }}>لا توجد أجور مسجلة لهذا الشهر.</td></tr> : salaries.map((salary) => <tr key={salary.id}><td>{teachers.find((teacher) => teacher.id === salary.teacher_id)?.full_name ?? "—"}</td><td>{salary.expected_amount.toLocaleString("fr-FR")} د.م</td><td>{salary.paid_amount.toLocaleString("fr-FR")} د.م</td><td><span className="payment مؤدى">{salary.payment_status === "paid" ? "مؤدى" : salary.payment_status === "partial" ? "جزئي" : "غير مؤدى"}</span></td><td>{salary.payment_date || "—"}</td><td>{salary.notes || "—"}</td></tr>)}</tbody></table></div>}</section>
    </>
  );
}

function AttendanceReports() {
  const [dateFrom, setDateFrom] = useState(() => new Date().toISOString().slice(0, 10));
  const [dateTo, setDateTo] = useState(() => new Date().toISOString().slice(0, 10));
  const [classId, setClassId] = useState("all");
  const [teacherId, setTeacherId] = useState("all");
  const [subjectId, setSubjectId] = useState("all");
  const [room, setRoom] = useState("all");
  const [level, setLevel] = useState("all");
  const [status, setStatus] = useState("all");
  const [classes, setClasses] = useState<ClassGroup[]>([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [rows, setRows] = useState<Array<{ id: string; date: string; time: string; student: string; level: string; className: string; subject: string; teacher: string; room: string; status: AttendanceStatus; reason: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadAttendanceReport = useCallback(async () => {
    setLoading(true);
    const supabase = createClient();
    const [sessionsResult, classesResult, subjectsResult, teachersResult, studentsResult] = await Promise.all([
      supabase.from("attendance_sessions").select("id, session_date, class_id, subject_id, teacher_id, room, start_time, end_time").gte("session_date", dateFrom).lte("session_date", dateTo),
      supabase.from("classes").select("id, name, level_code, room, is_active"),
      supabase.from("subjects").select("id, name"),
      supabase.from("teachers").select("id, full_name"),
      supabase.from("students").select("id, full_name, level_code"),
    ]);
    if (sessionsResult.error || classesResult.error || subjectsResult.error || teachersResult.error || studentsResult.error) {
      setError("تعذر تحميل تقرير الحضور.");
      setLoading(false);
      return;
    }
    const sessions = (sessionsResult.data ?? []) as AttendanceSessionRow[];
    const sessionIds = sessions.map((session) => session.id);
    const recordsResult = sessionIds.length ? await supabase.from("attendance_session_records").select("id, session_id, student_id, status, absence_reason").in("session_id", sessionIds) : { data: [], error: null };
    if (recordsResult.error) { setError("تعذر تحميل سجلات الحضور."); setLoading(false); return; }
    const classMap = Object.fromEntries((classesResult.data ?? []).map((item) => [String(item.id), item as ClassGroup]));
    const subjectMap = Object.fromEntries((subjectsResult.data ?? []).map((item) => [String(item.id), String(item.name)]));
    const teacherMap = Object.fromEntries((teachersResult.data ?? []).map((item) => [String(item.id), String(item.full_name)]));
    const studentMap = Object.fromEntries((studentsResult.data ?? []).map((item) => [String(item.id), item]));
    const sessionMap = Object.fromEntries(sessions.map((session) => [session.id, session]));
    setClasses(Object.values(classMap));
    setSubjects((subjectsResult.data ?? []) as Subject[]);
    setTeachers((teachersResult.data ?? []) as Teacher[]);
    setRows((recordsResult.data ?? []).map((record) => {
      const session = sessionMap[String(record.session_id)];
      const student = studentMap[String(record.student_id)];
      const group = classMap[String(session.class_id)];
      return { id: String(record.id), date: session.session_date, time: `${session.start_time.slice(0, 5)} - ${session.end_time.slice(0, 5)}`, student: String(student?.full_name ?? "—"), level: String(student?.level_code ?? ""), className: String(group?.name ?? "—"), subject: subjectMap[session.subject_id] ?? "—", teacher: teacherMap[session.teacher_id] ?? "—", room: session.room, status: record.status as AttendanceStatus, reason: String(record.absence_reason ?? "—") };
    }));
    setLoading(false);
  }, [dateFrom, dateTo]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadAttendanceReport(), 0);
    return () => window.clearTimeout(timer);
  }, [loadAttendanceReport]);

  const filteredRows = rows.filter((row) => (classId === "all" || classes.find((item) => item.name === row.className)?.id === classId) && (teacherId === "all" || teachers.find((item) => item.full_name === row.teacher)?.id === teacherId) && (subjectId === "all" || subjects.find((item) => item.name === row.subject)?.id === subjectId) && (room === "all" || row.room === room) && (level === "all" || row.level === level) && (status === "all" || row.status === status));
  const statusLabels: Record<AttendanceStatus, string> = { present: "حاضر", absent: "غائب", late: "متأخر", excused: "غائب بعذر" };

  return <section className="students-card" style={{ marginTop: 18 }}><div className="student-tools"><strong>تقرير الحضور اليومي والجلسات</strong></div><div style={{ padding: 16, display: "grid", gridTemplateColumns: "repeat(6, minmax(0, 1fr))", gap: 10 }}><label>من<input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} /></label><label>إلى<input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} /></label><label>القسم<select value={classId} onChange={(event) => setClassId(event.target.value)}><option value="all">كل الأقسام</option>{classes.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label>الأستاذ<select value={teacherId} onChange={(event) => setTeacherId(event.target.value)}><option value="all">كل الأساتذة</option>{teachers.map((item) => <option key={item.id} value={item.id}>{item.full_name}</option>)}</select></label><label>المادة<select value={subjectId} onChange={(event) => setSubjectId(event.target.value)}><option value="all">كل المواد</option>{subjects.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label>القاعة<select value={room} onChange={(event) => setRoom(event.target.value)}><option value="all">كل القاعات</option>{rooms.map((item) => <option key={item} value={item}>{item}</option>)}</select></label><label>المستوى<select value={level} onChange={(event) => setLevel(event.target.value)}><option value="all">كل المستويات</option>{levels.map((item) => <option key={item} value={levelToCode[item]}>{item}</option>)}</select></label><label>الحالة<select value={status} onChange={(event) => setStatus(event.target.value)}><option value="all">كل الحالات</option>{(Object.keys(statusLabels) as AttendanceStatus[]).map((item) => <option key={item} value={item}>{statusLabels[item]}</option>)}</select></label></div>{error ? <p className="form-error">{error}</p> : loading ? <div className="empty"><h2>جاري تحميل التقرير...</h2></div> : <div className="table-wrap"><table><thead><tr><th>التاريخ</th><th>الوقت</th><th>التلميذ</th><th>المستوى</th><th>القسم</th><th>المادة</th><th>الأستاذ</th><th>القاعة</th><th>الحالة</th><th>سبب الغياب</th></tr></thead><tbody>{filteredRows.length === 0 ? <tr><td colSpan={10} style={{ textAlign: "center", padding: 40 }}>لا توجد سجلات مطابقة.</td></tr> : filteredRows.map((row) => <tr key={row.id}><td>{row.date}</td><td>{row.time}</td><td>{row.student}</td><td>{codeToLevel[row.level] ?? row.level}</td><td>{row.className}</td><td>{row.subject}</td><td>{row.teacher}</td><td>{row.room}</td><td>{statusLabels[row.status]}</td><td>{row.reason}</td></tr>)}</tbody></table></div>}</section>;
}

function Reports() {
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [teacherId, setTeacherId] = useState("all");
  const [compensationType, setCompensationType] = useState("all");
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [payments, setPayments] = useState<{ id: string; student_id: string; teacher_id: string | null; amount_paid: number; teacher_share: number; center_share: number; compensation_type_snapshot: "percentage" | "fixed_monthly_salary" | null }[]>([]);
  const [salaries, setSalaries] = useState<TeacherSalaryPayment[]>([]);
  const [students, setStudents] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function loadReports(selectedMonth: string) {
    setLoading(true);
    const [year, monthNumber] = selectedMonth.split("-").map(Number);
    const nextMonth = new Date(Date.UTC(year, monthNumber, 1));
    const nextStart = `${nextMonth.getUTCFullYear()}-${String(nextMonth.getUTCMonth() + 1).padStart(2, "0")}-01`;
    const supabase = createClient();
    const [teachersResult, paymentsResult, salariesResult, studentsResult] = await Promise.all([
      supabase.from("teachers").select("*").order("full_name"),
      supabase.from("payments").select("id, student_id, teacher_id, amount_paid, teacher_share, center_share, compensation_type_snapshot").is("deleted_at", null).gte("payment_month", `${selectedMonth}-01`).lt("payment_month", nextStart),
      supabase.from("teacher_salary_payments").select("*").gte("salary_month", `${selectedMonth}-01`).lt("salary_month", nextStart),
      supabase.from("students").select("id, full_name"),
    ]);
    if (teachersResult.error || paymentsResult.error || salariesResult.error || studentsResult.error) {
      setError("تعذر تحميل التقرير المالي.");
    } else {
      setTeachers((teachersResult.data ?? []) as Teacher[]);
      setPayments((paymentsResult.data ?? []).map((row) => ({ ...row, amount_paid: Number(row.amount_paid ?? 0), teacher_share: Number(row.teacher_share ?? 0), center_share: Number(row.center_share ?? 0), teacher_id: row.teacher_id ? String(row.teacher_id) : null, compensation_type_snapshot: row.compensation_type_snapshot as "percentage" | "fixed_monthly_salary" | null })));
      setSalaries((salariesResult.data ?? []) as TeacherSalaryPayment[]);
      setStudents(Object.fromEntries((studentsResult.data ?? []).map((student) => [String(student.id), String(student.full_name)])));
    }
    setLoading(false);
  }

  useEffect(() => {
    const timer = window.setTimeout(() => void loadReports(month), 0);
    return () => window.clearTimeout(timer);
  }, [month]);

  const filteredPayments = payments.filter((payment) => (teacherId === "all" || payment.teacher_id === teacherId) && (compensationType === "all" || payment.compensation_type_snapshot === compensationType));
  const filteredSalaries = salaries.filter((salary) =>
    (teacherId === "all" || salary.teacher_id === teacherId) &&
    (compensationType === "all" || compensationType === "fixed_monthly_salary")
  );
  const totalCollected = filteredPayments.reduce((sum, payment) => sum + payment.amount_paid, 0);
  const percentageCosts = filteredPayments.reduce((sum, payment) => sum + payment.teacher_share, 0);
  const fixedCosts = filteredSalaries.reduce((sum, salary) => sum + salary.paid_amount, 0);
  const centerShare = filteredPayments.reduce((sum, payment) => sum + payment.center_share, 0);

  return (
    <>
      <section className="welcome sub"><div><p>الرئيسية ← التقارير</p><h1>تقارير التعويضات</h1><h2>مداخيل وأجور الأساتذة وحصة المركز حسب الشهر.</h2></div></section>
      <section className="content-card" style={{ marginBottom: 18 }}><div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 12 }}><label>الشهر<input type="month" value={month} onChange={(event) => setMonth(event.target.value)} /></label><label>الأستاذ<select value={teacherId} onChange={(event) => setTeacherId(event.target.value)}><option value="all">كل الأساتذة</option>{teachers.map((teacher) => <option key={teacher.id} value={teacher.id}>{teacher.full_name}</option>)}</select></label><label>طريقة الأجر<select value={compensationType} onChange={(event) => setCompensationType(event.target.value)}><option value="all">كل الطرق</option><option value="percentage">نسبة من الأداء</option><option value="fixed_monthly_salary">راتب ثابت</option></select></label></div></section>
      {error ? <div className="form-error">{error}</div> : loading ? <div className="empty"><h2>جاري تحميل التقرير...</h2></div> : <><section className="stats"><article className="stat-card"><div><span>إجمالي المحصل</span><strong>{totalCollected.toLocaleString("fr-FR")} د.م</strong></div></article><article className="stat-card"><div><span>حصص الأساتذة</span><strong>{percentageCosts.toLocaleString("fr-FR")} د.م</strong></div></article><article className="stat-card"><div><span>الأجور الثابتة</span><strong>{fixedCosts.toLocaleString("fr-FR")} د.م</strong></div></article><article className="stat-card"><div><span>حصة المركز</span><strong>{centerShare.toLocaleString("fr-FR")} د.م</strong></div></article></section><section className="students-card"><div className="student-tools"><strong>أداءات التلاميذ حسب الأستاذ</strong></div><div className="table-wrap"><table><thead><tr><th>التلميذ</th><th>الأستاذ</th><th>طريقة الأجر</th><th>الأداء</th><th>حصة الأستاذ</th><th>حصة المركز</th></tr></thead><tbody>{filteredPayments.length === 0 ? <tr><td colSpan={6} style={{ textAlign: "center", padding: 40 }}>لا توجد أداءات لهذا الشهر.</td></tr> : filteredPayments.map((payment) => <tr key={payment.id}><td>{students[payment.student_id] ?? "—"}</td><td>{teachers.find((teacher) => teacher.id === payment.teacher_id)?.full_name ?? "بدون أستاذ"}</td><td>{payment.compensation_type_snapshot === "percentage" ? "نسبة" : payment.compensation_type_snapshot === "fixed_monthly_salary" ? "راتب ثابت" : "—"}</td><td>{payment.amount_paid.toLocaleString("fr-FR")} د.م</td><td>{payment.teacher_share.toLocaleString("fr-FR")} د.م</td><td>{payment.center_share.toLocaleString("fr-FR")} د.م</td></tr>)}</tbody></table></div></section></>}
      <AttendanceReports />
    </>
  );
}

function Generic({ page }: { page: Section }) {
  const { t } = useLanguage();

  return (
    <section className="content-card">
      <div className="empty">
        <h1>{t(page)}</h1>
        <h2>{t("ready")}</h2>

        <p>
          {t("placeholder")} {t(page)}. {t("readyDesc")}
        </p>

        <button className="primary">
          {t("new")}
        </button>
      </div>
    </section>
  );
}

function Inner({ page }: { page: Section }) {
  const { lang, setLang, t } = useLanguage();
  const [open, setOpen] = useState(false);

  return (
    <div className="app-shell">
      <div
        className={`backdrop ${open ? "show" : ""}`}
        onClick={() => setOpen(false)}
      />

      <div
        className={`sidebar-holder ${
          open ? "show" : ""
        }`}
      >
        <Side
          page={page}
          close={() => setOpen(false)}
        />
      </div>

      <main className="main">
        <header className="topbar">
          <button
            type="button"
            className="mobile-menu"
            onClick={() => setOpen(true)}
            aria-label="فتح القائمة الرئيسية"
          >
            <Icon name="menu" />
          </button>

          <div className="search">
            <Icon name="search" />

            <input placeholder={t("search")} />
          </div>

          <div className="actions">
            <div className="language-switcher">
              <button
                type="button"
                className={
                  lang === "ar" ? "selected" : ""
                }
                onClick={() => setLang("ar")}
                aria-label="تبديل اللغة إلى العربية"
              >
                العربية
              </button>

              <button
                type="button"
                className={
                  lang === "fr" ? "selected" : ""
                }
                onClick={() => setLang("fr")}
                aria-label="Switch language to French"
              >
                FR
              </button>
            </div>

            <button type="button" className="notify" aria-label="الإشعارات">
              <Icon name="bell" />
              <i />
            </button>

            <div className="profile">
              <Avatar name="أ م" />

              <div>
                <strong>Ahmed Mohamed</strong>
                <span>{t("settings")}</span>
              </div>
            </div>
          </div>
        </header>

        <div className="page-content">
          {page === "dashboard" ? (
            <Dashboard />
          ) : page === "students" ? (
            <Students />
          ) : page === "payments" ? (
            <Payments />
          ) : page === "attendance" ? (
            <AttendanceSessions />
          ) : page === "teachers" ? (
            <Teachers />
          ) : page === "classes" ? (
            <Classes />
          ) : page === "subjects" ? (
            <Subjects />
          ) : page === "expenses" ? (
            <Expenses />
          ) : page === "reports" ? (
            <Reports />
          ) : (
            <Generic page={page} />
          )}
        </div>
      </main>
    </div>
  );
}

export default function AppShell({
  page,
}: {
  page: Section;
}) {
  return (
    <LanguageProvider>
      <Inner page={page} />
    </LanguageProvider>
  );
}

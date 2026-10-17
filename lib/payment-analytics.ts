const ACADEMIC_MONTHS = [
  { month: 9, label: "شتنبر" },
  { month: 10, label: "أكتوبر" },
  { month: 11, label: "نونبر" },
  { month: 12, label: "دجنبر" },
  { month: 1, label: "يناير" },
  { month: 2, label: "فبراير" },
  { month: 3, label: "مارس" },
  { month: 4, label: "أبريل" },
  { month: 5, label: "ماي" },
  { month: 6, label: "يونيو" },
] as const;

export type RevenuePayment = {
  id: string;
  student_id: string;
  payment_month: string;
  amount_paid: number;
};

export type RevenueStudent = {
  id: string;
  level_code: string | null;
};

export type AcademicRevenueMonth = {
  key: string;
  label: string;
  year: number;
  month: number;
};

export type MonthlyRevenue = AcademicRevenueMonth & {
  amount: number;
  studentCount: number;
  paymentCount: number;
};

export type MonthlyLevelRevenue = {
  monthKey: string;
  levelCode: string;
  amount: number;
  studentCount: number;
  paymentCount: number;
};

function getAcademicMonthKey(paymentMonth: string) {
  const match = /^(\d{4})-(0[1-9]|1[0-2])/.exec(paymentMonth);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  if (month >= 9 || month <= 6) return `${year}-${String(month).padStart(2, "0")}`;
  return null;
}

export function buildAcademicRevenueAnalytics(
  payments: RevenuePayment[],
  students: RevenueStudent[],
  startYear: number
) {
  const months: AcademicRevenueMonth[] = ACADEMIC_MONTHS.map(({ month, label }) => {
    const year = month >= 9 ? startYear : startYear + 1;
    return {
      key: `${year}-${String(month).padStart(2, "0")}`,
      label,
      year,
      month,
    };
  });
  const monthByKey = new Map(months.map((month) => [month.key, month]));
  const levelByStudentId = new Map(
    students.map((student) => [student.id, student.level_code?.trim() || null])
  );
  const levelCodes = [...new Set(
    students.map((student) => student.level_code?.trim()).filter((code): code is string => Boolean(code))
  )];
  const monthlyStudentSets = new Map(months.map((month) => [month.key, new Set<string>()]));
  const levelStudentSets = new Map<string, Set<string>>();
  const monthly = months.map((month) => ({
    ...month,
    amount: 0,
    studentCount: 0,
    paymentCount: 0,
  }));
  const monthlyByKey = new Map(monthly.map((month) => [month.key, month]));
  const monthlyLevelMap = new Map<string, MonthlyLevelRevenue>();

  months.forEach((month) => {
    levelCodes.forEach((levelCode) => {
      const key = `${month.key}:${levelCode}`;
      monthlyLevelMap.set(key, {
        monthKey: month.key,
        levelCode,
        amount: 0,
        studentCount: 0,
        paymentCount: 0,
      });
      levelStudentSets.set(key, new Set<string>());
    });
  });

  const seenPaymentIds = new Set<string>();
  let unassignedLevelAmount = 0;
  let unassignedLevelPaymentCount = 0;

  payments.forEach((payment) => {
    if (seenPaymentIds.has(payment.id)) return;
    seenPaymentIds.add(payment.id);

    const monthKey = getAcademicMonthKey(payment.payment_month);
    const month = monthKey ? monthByKey.get(monthKey) : undefined;
    const monthlyTotal = monthKey ? monthlyByKey.get(monthKey) : undefined;
    if (!month || !monthlyTotal) return;

    const amount = Number(payment.amount_paid);
    if (!Number.isFinite(amount)) return;

    monthlyTotal.amount += amount;
    monthlyTotal.paymentCount += 1;
    if (amount > 0) monthlyStudentSets.get(month.key)?.add(payment.student_id);

    const levelCode = levelByStudentId.get(payment.student_id);
    const levelTotal = levelCode ? monthlyLevelMap.get(`${month.key}:${levelCode}`) : undefined;
    if (!levelCode || !levelTotal) {
      unassignedLevelAmount += amount;
      unassignedLevelPaymentCount += 1;
      return;
    }

    levelTotal.amount += amount;
    levelTotal.paymentCount += 1;
    if (amount > 0) levelStudentSets.get(`${month.key}:${levelCode}`)?.add(payment.student_id);
  });

  monthly.forEach((month) => {
    month.studentCount = monthlyStudentSets.get(month.key)?.size ?? 0;
  });
  monthlyLevelMap.forEach((levelTotal, key) => {
    levelTotal.studentCount = levelStudentSets.get(key)?.size ?? 0;
  });

  const levelTotals = levelCodes.map((levelCode) => ({
    levelCode,
    amount: months.reduce(
      (sum, month) => sum + (monthlyLevelMap.get(`${month.key}:${levelCode}`)?.amount ?? 0),
      0
    ),
  }));

  return {
    months: monthly,
    levelCodes,
    levelTotals,
    monthlyByLevel: [...monthlyLevelMap.values()],
    unassignedLevelAmount,
    unassignedLevelPaymentCount,
  };
}

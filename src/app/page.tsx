'use client';

import { startTransition, useEffect, useRef, useState, type FormEvent } from 'react';
import { Car, Bike, Wrench, Settings, Plus, ChevronDown, Check, Loader2, MapPin, Pencil, X, Trash2, CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';
import { supabase } from '@/lib/supabaseClient';

export type MaintenanceTier = 'CẤP NHỎ' | 'CẤP TRUNG BÌNH' | 'CẤP TRUNG BÌNH LỚN' | 'CẤP LỚN';

export interface Vehicle {
  id: string;
  name: string;
  plate: string;
  current_odo: number;
  vehicle_type: 'CAR' | 'MOTORBIKE';
}

export interface MaintenanceItem {
  id: string;
  name: string;
  price?: number;
}

export interface MaintenanceEvent {
  id: string;
  vehicle_id: string;
  title: string;
  event_type: 'BẢO DƯỠNG' | 'SỬA CHỮA';
  maintenance_tier?: MaintenanceTier;
  target_odo: number;
  due_date: string;
  is_critical: boolean;
  total_cost: number;
  location?: string;
  notes?: string;
  maintenance_items?: MaintenanceItem[];
}

// Kiểu chung cho cả sự kiện lấy từ DB và mốc "Sắp tới" sinh tại client.
type TimelineItem = {
  id: string;
  title: string;
  event_type: 'BẢO DƯỠNG' | 'SỬA CHỮA';
  maintenance_tier?: MaintenanceTier;
  target_odo: number;
  due_date: string;
  total_cost: number;
  location?: string;
  notes?: string;
  maintenance_items?: MaintenanceItem[];
  isFuture: boolean;
  isNearest: boolean;
};

// Trạng thái tải của từng nguồn dữ liệu (xe / lịch sử bảo dưỡng).
type LoadState = 'loading' | 'ready' | 'error';

type VehicleFormMode = 'create' | 'edit';

type VehicleFormValues = {
  name: string;
  plate: string;
  current_odo: string;
  vehicle_type: Vehicle['vehicle_type'];
};

const EMPTY_VEHICLE_FORM: VehicleFormValues = {
  name: '',
  plate: '',
  current_odo: '',
  vehicle_type: 'CAR',
};

// Một dòng "mục thực hiện" trong form; giá tiền giữ dạng chuỗi để cho phép rỗng.
type ServiceFormItem = {
  key: string;
  name: string;
  price: string;
};

type ServiceFormValues = {
  event_type: MaintenanceEvent['event_type'];
  maintenance_tier: MaintenanceTier;
  // Tiêu đề tự nhập, chỉ dùng cho SỬA CHỮA (BẢO DƯỠNG lấy tiêu đề từ mốc).
  title: string;
  location: string;
  due_date: string;
  // Ngày hiện tại lúc mở form — dùng làm `max` để chỉ chọn được hôm nay hoặc trước đó.
  max_date: string;
  target_odo: string;
  notes: string;
  items: ServiceFormItem[];
};

// Hai loại sự kiện khớp với CHECK constraint của maintenance_events.event_type.
const SERVICE_EVENT_TYPES: { value: MaintenanceEvent['event_type']; label: string }[] = [
  { value: 'BẢO DƯỠNG', label: 'Bảo dưỡng' },
  { value: 'SỬA CHỮA', label: 'Sửa chữa' },
];

// 4 mốc bảo dưỡng dùng làm tiêu đề sự kiện (khớp maintenance_tier trong DB).
const MAINTENANCE_TIERS: { value: MaintenanceTier; label: string }[] = [
  { value: 'CẤP NHỎ', label: 'Cấp nhỏ' },
  { value: 'CẤP TRUNG BÌNH', label: 'Cấp trung bình' },
  { value: 'CẤP TRUNG BÌNH LỚN', label: 'Cấp trung bình lớn' },
  { value: 'CẤP LỚN', label: 'Cấp lớn' },
];

const FORM_FIELD_CLASS =
  'w-full rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-3 py-2 text-sm text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/30';

function maintenanceTitle(tier: MaintenanceTier) {
  const label = MAINTENANCE_TIERS.find((option) => option.value === tier)?.label ?? tier;
  return `Bảo dưỡng ${label.toLowerCase()}`;
}

// "yyyy-mm-dd" theo giờ máy người dùng — không dùng toISOString() để tránh lệch múi giờ.
function toDateInputValue(date: Date) {
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

// Đọc "yyyy-mm-dd" thành Date tại 00:00 giờ máy (không parse theo UTC như new Date(string)).
function parseDateInputValue(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;

  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatDateDisplay(value: string) {
  const date = parseDateInputValue(value);
  if (!date) return 'Chọn ngày';

  const day = `${date.getDate()}`.padStart(2, '0');
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  return `${day}/${month}/${date.getFullYear()}`;
}

const WEEKDAY_LABELS = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'];
const MONTH_LABELS = [
  'Tháng 1',
  'Tháng 2',
  'Tháng 3',
  'Tháng 4',
  'Tháng 5',
  'Tháng 6',
  'Tháng 7',
  'Tháng 8',
  'Tháng 9',
  'Tháng 10',
  'Tháng 11',
  'Tháng 12',
];

type CalendarMonth = { year: number; month: number };

const monthIndex = (value: CalendarMonth) => value.year * 12 + value.month;

// Lưới ngày của tháng, tuần bắt đầu Thứ 2; null = ô trống để căn cột.
function buildMonthGrid({ year, month }: CalendarMonth): (string | null)[] {
  const leadingBlanks = (new Date(year, month, 1).getDay() + 6) % 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: (string | null)[] = Array.from({ length: leadingBlanks }, () => null);

  for (let day = 1; day <= daysInMonth; day += 1) {
    cells.push(toDateInputValue(new Date(year, month, day)));
  }

  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

type ServiceDatePickerProps = {
  value: string;
  maxDate: string;
  month: CalendarMonth;
  onChangeMonth: (month: CalendarMonth) => void;
  onSelect: (date: string) => void;
};

// Calendar tự dựng: input type="date" của trình duyệt chỉ báo invalid chứ không
// disable ngày tương lai trong picker, nên tự render lưới ngày để chặn hẳn.
function ServiceDatePicker({ value, maxDate, month, onChangeMonth, onSelect }: ServiceDatePickerProps) {
  const maxMonth = parseDateInputValue(maxDate);
  const canGoNext = maxMonth
    ? monthIndex(month) < monthIndex({ year: maxMonth.getFullYear(), month: maxMonth.getMonth() })
    : false;

  const goToPreviousMonth = () =>
    onChangeMonth(
      month.month === 0 ? { year: month.year - 1, month: 11 } : { year: month.year, month: month.month - 1 }
    );

  const goToNextMonth = () => {
    if (!canGoNext) return;
    onChangeMonth(
      month.month === 11 ? { year: month.year + 1, month: 0 } : { year: month.year, month: month.month + 1 }
    );
  };

  return (
    <div
      role="group"
      aria-label="Chọn ngày làm"
      className="rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-950 p-2.5 sm:p-3"
    >
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={goToPreviousMonth}
          aria-label="Tháng trước"
          className="rounded-lg p-1.5 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-white transition-colors"
        >
          <ChevronLeft size={16} />
        </button>
        <span className="text-xs sm:text-sm font-semibold text-zinc-900 dark:text-zinc-100">
          {MONTH_LABELS[month.month]} {month.year}
        </span>
        <button
          type="button"
          onClick={goToNextMonth}
          disabled={!canGoNext}
          aria-label="Tháng sau"
          className="rounded-lg p-1.5 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-white disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-zinc-500 transition-colors"
        >
          <ChevronRight size={16} />
        </button>
      </div>

      <div className="mt-2 grid grid-cols-7 gap-1">
        {WEEKDAY_LABELS.map((label) => (
          <span key={label} className="text-center text-[10px] sm:text-xs font-medium text-zinc-400">
            {label}
          </span>
        ))}
      </div>

      <div className="mt-1 grid grid-cols-7 gap-1">
        {buildMonthGrid(month).map((date, index) => {
          if (!date) return <span key={`blank-${month.year}-${month.month}-${index}`} />;

          const isSelected = date === value;
          const isToday = date === maxDate;
          // Chỉ cho chọn hôm nay hoặc trước đó.
          const isDisabled = date > maxDate;

          return (
            <button
              key={date}
              type="button"
              onClick={() => onSelect(date)}
              disabled={isDisabled}
              aria-pressed={isSelected}
              aria-label={formatDateDisplay(date)}
              className={`h-8 sm:h-9 rounded-lg text-xs sm:text-sm font-medium transition-colors ${
                isSelected
                  ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900'
                  : isDisabled
                    ? 'cursor-not-allowed text-zinc-300 dark:text-zinc-700'
                    : `text-zinc-700 hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-800 ${
                        isToday ? 'ring-1 ring-emerald-500' : ''
                      }`
              }`}
            >
              {Number(date.slice(-2))}
            </button>
          );
        })}
      </div>
    </div>
  );
}

let serviceItemKeySeed = 0;

function createServiceItem(name = '', price = ''): ServiceFormItem {
  serviceItemKeySeed += 1;
  return { key: `service-item-${serviceItemKeySeed}`, name, price };
}

// Chỉ gọi trong event handler khi mở form: đọc ngày hiện tại ở đây an toàn cho prerender.
function createServiceFormValues(vehicle: Vehicle): ServiceFormValues {
  const today = toDateInputValue(new Date());

  return {
    event_type: 'BẢO DƯỠNG',
    maintenance_tier: 'CẤP NHỎ',
    title: '',
    location: '',
    due_date: today,
    max_date: today,
    target_odo: vehicle.current_odo.toString(),
    notes: '',
    items: [createServiceItem()],
  };
}

// Ô tô luôn đứng trước xe máy; sort ổn định nên giữ nguyên thứ tự còn lại.
function sortVehicles(list: Vehicle[]) {
  return [...list].sort(
    (a, b) => (a.vehicle_type === 'CAR' ? 0 : 1) - (b.vehicle_type === 'CAR' ? 0 : 1)
  );
}

function generateNextMilestone(currentOdo: number, type: 'CAR' | 'MOTORBIKE', lastMaintenanceDate?: string) {
  const step = type === 'CAR' ? 5000 : 2000;
  const monthsStep = type === 'CAR' ? 6 : 3; 

  const nextOdo = Math.floor(currentOdo / step) * step + step;

  const baseDate = lastMaintenanceDate ? new Date(lastMaintenanceDate) : new Date();
  const nextDate = new Date(baseDate);
  nextDate.setMonth(nextDate.getMonth() + monthsStep);

  let tier: MaintenanceTier = 'CẤP NHỎ';
  let title = 'Bảo dưỡng cấp nhỏ';
  let defaultItems: { name: string; price?: number }[] = [];

  if (type === 'CAR') {
    if (nextOdo % 40000 === 0) {
      tier = 'CẤP LỚN';
      title = 'Bảo dưỡng cấp lớn';
      defaultItems = [
        { name: 'Thay thế: Dầu máy, lọc dầu, lọc gió điều hòa, bugi, dầu cầu, dầu hộp số, nước làm mát' },
        { name: 'Kiểm tra: Động cơ, Hệ thống đánh lửa, Gầm và thân xe, Hệ thống điện thân xe, Hệ thống điều hòa, Hệ thống nhiên liệu và kiểm soát khí xả' }
      ];
    } else if (nextOdo % 20000 === 0) {
      tier = 'CẤP TRUNG BÌNH LỚN';
      title = 'Bảo dưỡng cấp trung bình lớn';
      defaultItems = [
        { name: 'Thay thế: Dầu máy, lọc dầu, lọc gió điều hòa, bugi' },
        { name: 'Kiểm tra và bổ sung: Nước rửa kính, nước làm mát nếu cần' },
        { name: 'Kiểm tra: Động cơ, Hệ thống đánh lửa, Gầm và thân xe, Hệ thống điện thân xe, Hệ thống điều hòa, Hệ thống nhiên liệu và kiểm soát khí xả' }
      ];
    } else if (nextOdo % 10000 === 0) {
      tier = 'CẤP TRUNG BÌNH';
      title = 'Bảo dưỡng cấp trung bình';
      defaultItems = [
        { name: 'Thay thế: Dầu máy, lọc dầu, lọc gió điều hòa' },
        { name: 'Kiểm tra và bổ sung: Nước rửa kính, nước làm mát nếu cần' },
        { name: 'Kiểm tra: Động cơ, Hệ thống đánh lửa, Gầm và thân xe, Hệ thống điện thân xe, Hệ thống điều hòa' }
      ];
    } else {
      tier = 'CẤP NHỎ';
      title = 'Bảo dưỡng cấp nhỏ';
      defaultItems = [
        { name: 'Thay thế: Dầu máy' },
        { name: 'Kiểm tra và bổ sung: Nước rửa kính, nước làm mát nếu cần' },
        { name: 'Kiểm tra: Động cơ, Hệ thống đánh lửa, Gầm và thân xe, Hệ thống điện thân xe' }
      ];
    }
  } else {
    if (nextOdo % 10000 === 0) {
      tier = 'CẤP LỚN';
      title = 'Bảo dưỡng cấp lớn';
      defaultItems = [{ name: 'Vệ sinh buồng đốt' }, { name: 'Bảo dưỡng nồi/nhông xích' }];
    } else if (nextOdo % 6000 === 0) {
      tier = 'CẤP TRUNG BÌNH';
      title = 'Bảo dưỡng cấp trung bình';
      defaultItems = [{ name: 'Thay lọc gió' }, { name: 'Thay dầu máy' }];
    } else {
      tier = 'CẤP NHỎ';
      title = 'Bảo dưỡng cấp nhỏ';
      defaultItems = [{ name: 'Thay dầu máy' }];
    }
  }

  return {
    id: 'virtual-upcoming-event',
    title: title,
    event_type: 'BẢO DƯỠNG' as const,
    maintenance_tier: tier,
    target_odo: nextOdo,
    due_date: nextDate.toISOString(), 
    isFuture: true,
    isNearest: true,
    total_cost: 0,
    maintenance_items: defaultItems.map((item, idx) => ({ id: `v-item-${idx}`, ...item }))
  };
}

export default function Dashboard() {
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [activeVid, setActiveVid] = useState<string>('');
  const [events, setEvents] = useState<MaintenanceEvent[]>([]);

  const [vehiclesState, setVehiclesState] = useState<LoadState>('loading');
  const [eventsState, setEventsState] = useState<LoadState>('loading');
  const [reloadToken, setReloadToken] = useState(0);

  const retry = () => setReloadToken((token) => token + 1);
  
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [expandedCards, setExpandedCards] = useState<string[]>([]);
  const [collapsedYears, setCollapsedYears] = useState<string[]>([]);
  const [yearOverrides, setYearOverrides] = useState<Record<string, boolean>>({});

  const [vehicleFormMode, setVehicleFormMode] = useState<VehicleFormMode | null>(null);
  const [editingVehicle, setEditingVehicle] = useState<Vehicle | null>(null);
  const [vehicleFormValues, setVehicleFormValues] = useState<VehicleFormValues>(EMPTY_VEHICLE_FORM);
  const [vehicleFormError, setVehicleFormError] = useState<string | null>(null);
  const [isSavingVehicle, setIsSavingVehicle] = useState(false);

  // null = modal ghi nhận dịch vụ đang đóng; có giá trị = đang mở.
  const [serviceForm, setServiceForm] = useState<ServiceFormValues | null>(null);
  const [serviceFormError, setServiceFormError] = useState<string | null>(null);
  const [isSavingService, setIsSavingService] = useState(false);
  // Tháng đang xem của calendar; null = calendar đang đóng.
  const [serviceDatePickerMonth, setServiceDatePickerMonth] = useState<CalendarMonth | null>(null);
  const serviceDatePickerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let ignore = false;

    async function fetchVehicles() {
      setVehiclesState('loading');
      try {
        const { data, error } = await supabase
          .from('vehicles')
          .select('*')
          .order('created_at', { ascending: true });
        
        if (error) throw error;
        if (ignore) return;

        const sortedVehicles = sortVehicles(data ?? []);

        setVehicles(sortedVehicles);
        // Giữ xe đang chọn nếu vẫn tồn tại, tránh nhảy về xe đầu khi thử lại
        setActiveVid((prev) =>
          sortedVehicles.some((v) => v.id === prev) ? prev : (sortedVehicles[0]?.id ?? '')
        );
        setVehiclesState('ready');
      } catch (err) {
        if (ignore) return;
        console.error('Lỗi khi tải danh sách xe:', err);
        setVehiclesState('error');
      }
    }
    fetchVehicles();
    return () => {
      ignore = true;
    };
  }, [reloadToken]);

  useEffect(() => {
    // Không có xe thì không có gì để tải. `isLoading` đã suy ra từ `activeVid`
    // nên không cần setState đồng bộ ở đây (tránh cascading render).
    if (!activeVid) return;

    let ignore = false;

    async function fetchMaintenanceEvents() {
      setEventsState('loading');
      try {
        const { data, error } = await supabase
          .from('maintenance_events')
          .select(`
            id,
            vehicle_id,
            title,
            event_type,
            maintenance_tier,
            target_odo,
            due_date,
            is_critical,
            total_cost,
            location,
            notes,
            maintenance_items (
              id,
              name,
              price
            )
          `)
          .eq('vehicle_id', activeVid)
          .order('target_odo', { ascending: false });

        if (error) throw error;
        if (ignore) return;

        setEvents((data ?? []) as unknown as MaintenanceEvent[]);
        setEventsState('ready');
      } catch (err) {
        if (ignore) return;
        console.error('Lỗi khi tải sự kiện bảo dưỡng:', err);
        setEventsState('error');
      }
    }

    fetchMaintenanceEvents();
    return () => {
      ignore = true;
    };
  }, [activeVid, reloadToken]);

  const activeVehicle = vehicles.find((v) => v.id === activeVid);

  const isLoading =
    vehiclesState === 'loading' ||
    (activeVid !== '' && eventsState === 'loading');
  const hasVehiclesError = vehiclesState === 'error';
  const hasEventsError = eventsState === 'error';

  const toggleCard = (id: string) => {
    setExpandedCards((prev) =>
      prev.includes(id) ? prev.filter((cardId) => cardId !== id) : [...prev, id]
    );
  };

  const toggleYear = (year: string) => {
    setYearOverrides((prev) => ({
      ...prev,
      [year]: !(prev[year] ?? collapsedYears.includes(year)),
    }));
  };

  const openCreateVehicleForm = () => {
    setIsMenuOpen(false);
    setVehicleFormMode('create');
    setEditingVehicle(null);
    setVehicleFormValues(EMPTY_VEHICLE_FORM);
    setVehicleFormError(null);
  };

  const openEditVehicleForm = (vehicle: Vehicle) => {
    setIsMenuOpen(false);
    setVehicleFormMode('edit');
    setEditingVehicle(vehicle);
    setVehicleFormValues({
      name: vehicle.name,
      plate: vehicle.plate,
      current_odo: vehicle.current_odo.toString(),
      vehicle_type: vehicle.vehicle_type,
    });
    setVehicleFormError(null);
  };

  const closeVehicleForm = () => {
    if (isSavingVehicle) return;
    setVehicleFormMode(null);
    setEditingVehicle(null);
    setVehicleFormError(null);
  };

  const handleVehicleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isSavingVehicle) return;

    const name = vehicleFormValues.name.trim();
    const plate = vehicleFormValues.plate.trim();
    const odoRaw = vehicleFormValues.current_odo.trim();
    const odo = Number(odoRaw);

    if (!name) {
      setVehicleFormError('Vui lòng nhập tên xe.');
      return;
    }
    if (!plate) {
      setVehicleFormError('Vui lòng nhập biển số.');
      return;
    }
    if (odoRaw === '' || !Number.isInteger(odo) || odo < 0) {
      setVehicleFormError('ODO phải là số nguyên không âm.');
      return;
    }

    const payload = {
      name,
      plate,
      current_odo: odo,
      vehicle_type: vehicleFormValues.vehicle_type,
    };

    setIsSavingVehicle(true);
    setVehicleFormError(null);

    try {
      if (vehicleFormMode === 'edit' && editingVehicle) {
        const { error } = await supabase
          .from('vehicles')
          .update(payload)
          .eq('id', editingVehicle.id);

        if (error) throw error;

        setVehicles((prev) =>
          prev.map((vehicle) =>
            vehicle.id === editingVehicle.id ? { ...vehicle, ...payload } : vehicle
          )
        );
      } else {
        const { data, error } = await supabase
          .from('vehicles')
          .insert(payload)
          .select()
          .single();

        if (error) throw error;

        const createdVehicle = data as Vehicle;
        setVehicles((prev) => sortVehicles([...prev, createdVehicle]));

        if (createdVehicle.id !== activeVid) {
          setActiveVid(createdVehicle.id);
          // Xe mới chưa có lịch sử: hiện spinner trong lúc effect tải dữ liệu
          setEventsState('loading');
        }
      }

      setVehicleFormMode(null);
      setEditingVehicle(null);
      setVehicleFormError(null);
    } catch (err) {
      console.error('Lỗi khi lưu xe:', err);
      const code = (err as { code?: string } | null)?.code;

      if (code === '23505') {
        setVehicleFormError('Biển số này đã tồn tại trong garage.');
      } else if (code === '42501') {
        setVehicleFormError('Không có quyền ghi dữ liệu xe. Kiểm tra RLS của bảng vehicles.');
      } else {
        setVehicleFormError('Không lưu được xe. Kiểm tra kết nối rồi thử lại.');
      }
    } finally {
      setIsSavingVehicle(false);
    }
  };

  const openServiceForm = () => {
    if (!activeVehicle) return;
    setIsMenuOpen(false);
    setServiceFormError(null);
    setServiceDatePickerMonth(null);
    setServiceForm(createServiceFormValues(activeVehicle));
  };

  const closeServiceForm = () => {
    if (isSavingService) return;
    setServiceForm(null);
    setServiceFormError(null);
    setServiceDatePickerMonth(null);
  };

  const updateServiceForm = (patch: Partial<ServiceFormValues>) => {
    setServiceForm((prev) => (prev ? { ...prev, ...patch } : prev));
  };

  const toggleServiceDatePicker = () => {
    if (serviceDatePickerMonth) {
      setServiceDatePickerMonth(null);
      return;
    }
    if (!serviceForm) return;

    // Mở calendar tại tháng của ngày đang chọn (serviceForm đã có sẵn "hôm nay" lúc mở form).
    const anchor =
      parseDateInputValue(serviceForm.due_date) ?? parseDateInputValue(serviceForm.max_date);
    if (!anchor) return;

    setServiceDatePickerMonth({ year: anchor.getFullYear(), month: anchor.getMonth() });
  };

  const selectServiceDate = (date: string) => {
    // Calendar đã chặn ngày tương lai, kiểm tra lại để chắc chắn dữ liệu sạch.
    if (serviceForm && date > serviceForm.max_date) return;
    updateServiceForm({ due_date: date });
    setServiceDatePickerMonth(null);
  };

  const addServiceItem = () => {
    setServiceForm((prev) =>
      prev ? { ...prev, items: [...prev.items, createServiceItem()] } : prev
    );
  };

  const updateServiceItem = (key: string, patch: Partial<Omit<ServiceFormItem, 'key'>>) => {
    setServiceForm((prev) =>
      prev
        ? {
            ...prev,
            items: prev.items.map((item) =>
              item.key === key ? { ...item, ...patch } : item
            ),
          }
        : prev
    );
  };

  const removeServiceItem = (key: string) => {
    setServiceForm((prev) =>
      prev ? { ...prev, items: prev.items.filter((item) => item.key !== key) } : prev
    );
  };

  const handleServiceSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!serviceForm || isSavingService || !activeVehicle) return;

    const isMaintenance = serviceForm.event_type === 'BẢO DƯỠNG';
    const title = isMaintenance
      ? maintenanceTitle(serviceForm.maintenance_tier)
      : serviceForm.title.trim();
    const odoRaw = serviceForm.target_odo.trim();
    const odo = Number(odoRaw);
    const dueDate = serviceForm.due_date;
    const location = serviceForm.location.trim();
    const notes = serviceForm.notes.trim();

    // Bỏ các dòng để trống tên; giá trống coi như 0.
    const items = serviceForm.items
      .map((item) => ({
        name: item.name.trim(),
        price: item.price.trim() === '' ? 0 : Number(item.price.trim()),
      }))
      .filter((item) => item.name !== '');

    if (odoRaw === '' || !Number.isInteger(odo) || odo < 0) {
      setServiceFormError('ODO phải là số nguyên không âm.');
      return;
    }
    if (!dueDate || Number.isNaN(new Date(dueDate).getTime())) {
      setServiceFormError('Vui lòng chọn ngày làm dịch vụ.');
      return;
    }
    // Chuỗi yyyy-mm-dd so sánh trực tiếp được theo thứ tự thời gian.
    if (dueDate > serviceForm.max_date) {
      setServiceFormError('Ngày làm không được sau hôm nay.');
      return;
    }
    if (!isMaintenance && !title) {
      setServiceFormError('Vui lòng nhập nội dung sửa chữa.');
      return;
    }
    if (items.length === 0) {
      setServiceFormError('Vui lòng nhập ít nhất một mục thực hiện.');
      return;
    }
    if (items.some((item) => !Number.isInteger(item.price) || item.price < 0)) {
      setServiceFormError('Giá tiền của từng mục phải là số nguyên không âm.');
      return;
    }

    const totalCost = items.reduce((sum, item) => sum + item.price, 0);

    setIsSavingService(true);
    setServiceFormError(null);

    try {
      // PostgREST của project này không nhận nested insert cho maintenance_items,
      // nên ghi 2 bước: sự kiện trước, rồi các mục thực hiện.
      const { data, error } = await supabase
        .from('maintenance_events')
        .insert({
          vehicle_id: activeVehicle.id,
          title,
          event_type: serviceForm.event_type,
          maintenance_tier: isMaintenance ? serviceForm.maintenance_tier : null,
          target_odo: odo,
          due_date: dueDate,
          is_critical: false,
          total_cost: totalCost,
          location: location || null,
          notes: notes || null,
        })
        .select(
          `
            id,
            vehicle_id,
            title,
            event_type,
            maintenance_tier,
            target_odo,
            due_date,
            is_critical,
            total_cost,
            location,
            notes
          `
        )
        .single();

      if (error) throw error;

      const createdEvent = data as unknown as MaintenanceEvent;

      const { data: createdItems, error: itemsError } = await supabase
        .from('maintenance_items')
        .insert(
          items.map((item) => ({
            event_id: createdEvent.id,
            name: item.name,
            price: item.price,
          }))
        )
        .select('id, name, price');

      if (itemsError) {
        // Không để lại sự kiện rỗng nếu ghi hạng mục thất bại.
        const { error: cleanupError } = await supabase
          .from('maintenance_events')
          .delete()
          .eq('id', createdEvent.id);

        if (cleanupError) {
          console.error('Không xoá được sự kiện vừa tạo sau khi ghi hạng mục lỗi:', cleanupError);
        }
        throw itemsError;
      }

      const createdEventWithItems: MaintenanceEvent = {
        ...createdEvent,
        maintenance_items: (createdItems as unknown as MaintenanceItem[] | null) ?? [],
      };

      setEvents((prev) => [createdEventWithItems, ...prev]);
      setEventsState('ready');

      // ODO ghi nhận lớn hơn ODO của xe → cập nhật luôn ODO hiện tại.
      if (odo > activeVehicle.current_odo) {
        const { error: odoError } = await supabase
          .from('vehicles')
          .update({ current_odo: odo })
          .eq('id', activeVehicle.id);

        if (odoError) {
          console.error('Lỗi khi cập nhật ODO của xe:', odoError);
        } else {
          setVehicles((prev) =>
            prev.map((vehicle) =>
              vehicle.id === activeVehicle.id ? { ...vehicle, current_odo: odo } : vehicle
            )
          );
        }
      }

      setServiceForm(null);
      setServiceFormError(null);
      setServiceDatePickerMonth(null);
    } catch (err) {
      console.error('Lỗi khi lưu sự kiện bảo dưỡng:', err);
      const code = (err as { code?: string } | null)?.code;

      if (code === '42501') {
        setServiceFormError(
          'Không có quyền ghi dữ liệu bảo dưỡng. Kiểm tra RLS của bảng maintenance_events và maintenance_items.'
        );
      } else if (code === '23503') {
        setServiceFormError('Xe này không còn tồn tại. Tải lại trang rồi thử lại.');
      } else {
        setServiceFormError('Không lưu được sự kiện. Kiểm tra kết nối rồi thử lại.');
      }
    } finally {
      setIsSavingService(false);
    }
  };

  // Chỉ dùng lịch sử của xe đang chọn — tránh hiển thị dữ liệu của xe khác trong lúc chờ fetch
  const activeEvents = events.filter((event) => event.vehicle_id === activeVid);

  const pastEvents = [...activeEvents].sort((a, b) => b.target_odo - a.target_odo);
  
  const lastMaintenance = pastEvents.find(e => e.event_type === 'BẢO DƯỠNG');

  const virtualUpcomingEvent = activeVehicle 
    ? generateNextMilestone(activeVehicle.current_odo, activeVehicle.vehicle_type, lastMaintenance?.due_date) 
    : null;

  const unifiedTimeline: TimelineItem[] = [
    ...(virtualUpcomingEvent ? [virtualUpcomingEvent] : []),
    ...pastEvents.map((h) => ({ ...h, isFuture: false, isNearest: false }))
  ];

  // Năm của mốc "Sắp tới" — chỉ parse từ dữ liệu, không đọc giờ hiện tại khi render.
  const upcomingYear = virtualUpcomingEvent
    ? new Date(virtualUpcomingEvent.due_date).getFullYear().toString()
    : null;

  const groupedTimeline: { year: string; items: typeof unifiedTimeline }[] = [];
  unifiedTimeline.forEach((item) => {
    const year = item.due_date ? new Date(item.due_date).getFullYear().toString() : 'Khác';
    const lastGroup = groupedTimeline[groupedTimeline.length - 1];

    if (lastGroup && lastGroup.year === year) {
      lastGroup.items.push(item);
    } else {
      groupedTimeline.push({ year, items: [item] });
    }
  });

  const timelineYearsKey = groupedTimeline.map((group) => group.year).join(',');

  useEffect(() => {
    const currentYear = new Date().getFullYear();
    const keepExpanded = new Set([
      currentYear.toString(),
      (currentYear - 1).toString(),
    ]);
    // Mốc "Sắp tới" phải luôn nhìn thấy được, kể cả khi rơi vào năm khác.
    if (upcomingYear) keepExpanded.add(upcomingYear);

    const collapsed = timelineYearsKey
      ? timelineYearsKey.split(',').filter((year) => {
          // Giữ nguyên hành vi cũ: nhóm không phải năm số (vd. "Khác") luôn mở
          const yearNumber = parseInt(year, 10);
          return !isNaN(yearNumber) && !keepExpanded.has(year);
        })
      : [];

    startTransition(() => {
      setCollapsedYears(collapsed);
      // Tập năm thay đổi (đổi xe / tải lại) → quay về trạng thái mặc định
      setYearOverrides({});
    });
  }, [timelineYearsKey, upcomingYear]);

  useEffect(() => {
    if (!vehicleFormMode) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !isSavingVehicle) {
        setVehicleFormMode(null);
        setEditingVehicle(null);
        setVehicleFormError(null);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [vehicleFormMode, isSavingVehicle]);

  const isServiceFormOpen = serviceForm !== null;

  useEffect(() => {
    if (!isServiceFormOpen) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || isSavingService) return;

      // Esc đóng calendar trước; nhấn lần nữa mới đóng modal.
      if (serviceDatePickerMonth) {
        setServiceDatePickerMonth(null);
        return;
      }

      setServiceForm(null);
      setServiceFormError(null);
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isServiceFormOpen, isSavingService, serviceDatePickerMonth]);

  // Calendar mở ngay dưới ô ngày — cuộn vào tầm nhìn để không bị khuất trong form.
  useEffect(() => {
    if (!serviceDatePickerMonth) return;
    serviceDatePickerRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [serviceDatePickerMonth]);

  // Trạng thái mặc định (collapsedYears) + lựa chọn thủ công của người dùng (yearOverrides).
  const isYearCollapsedFor = (year: string) =>
    yearOverrides[year] ?? collapsedYears.includes(year);

  // Tổng tiền hiển thị ngay trong form (chỉ cộng các dòng có giá hợp lệ).
  const serviceFormTotal = serviceForm
    ? serviceForm.items.reduce((sum, item) => {
        const price = Number(item.price.trim());
        return Number.isInteger(price) && price > 0 ? sum + price : sum;
      }, 0)
    : 0;

  // ODO nhập vào lớn hơn ODO hiện tại của xe → sẽ cập nhật lại xe sau khi lưu.
  const serviceFormOdo = serviceForm ? Number(serviceForm.target_odo.trim()) : NaN;
  const willUpdateVehicleOdo =
    !!activeVehicle && Number.isInteger(serviceFormOdo) && serviceFormOdo > activeVehicle.current_odo;

  return (
    <div className="flex flex-col h-[100dvh] bg-zinc-50 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 font-sans transition-colors duration-200 relative">
      
      {/* HEADER DROPDOWN */}
      <header className="flex-shrink-0 border-b border-zinc-200 dark:border-zinc-800/60 bg-white dark:bg-zinc-950 px-4 py-3 sm:px-5 sm:py-4 flex items-center justify-center z-20 relative shadow-sm">
        <div className="relative">
          <button
            onClick={() => setIsMenuOpen(!isMenuOpen)}
            className="flex items-center gap-3 px-2 py-1.5 -ml-2 sm:gap-4 sm:px-3 sm:py-2 sm:-ml-3 rounded-xl hover:bg-zinc-100 dark:hover:bg-zinc-900 transition-colors"
          >
            <div className="bg-zinc-100 dark:bg-zinc-800 p-2 sm:p-2.5 rounded-lg text-zinc-600 dark:text-zinc-300">
              {activeVehicle?.vehicle_type === 'MOTORBIKE' ? <Bike className="w-5 h-5 sm:w-6 sm:h-6" /> : <Car className="w-5 h-5 sm:w-6 sm:h-6" />}
            </div>
            <div className="text-left flex flex-col justify-center">
              <p className="font-bold text-sm sm:text-base leading-tight text-zinc-900 dark:text-zinc-100">
                {activeVehicle
                  ? activeVehicle.name
                  : vehiclesState === 'loading'
                    ? 'Đang tải xe...'
                    : vehiclesState === 'error'
                      ? 'Không tải được xe'
                      : 'Chưa có xe'}
              </p>
              {activeVehicle && (
                <div className="flex items-center gap-1.5 sm:gap-2 mt-0.5 sm:mt-1">
                  <span className="text-[10px] sm:text-xs uppercase font-semibold text-zinc-500">ODO</span>
                  <span className="text-xs sm:text-sm font-mono font-bold text-emerald-600 dark:text-emerald-500">
                    {activeVehicle.current_odo.toLocaleString('vi-VN')} km
                  </span>
                </div>
              )}
            </div>
            <ChevronDown size={18} className={`ml-1 sm:ml-2 text-zinc-400 transition-transform duration-200 ${isMenuOpen ? 'rotate-180' : ''}`} />
          </button>

          {isMenuOpen && (
            <>
              <div className="fixed inset-0 z-30" onClick={() => setIsMenuOpen(false)}></div>
              <div className="absolute top-full left-1/2 -translate-x-1/2 mt-2 sm:mt-3 w-[min(20rem,calc(100vw-2rem))] bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800/60 rounded-2xl shadow-xl z-40 overflow-hidden py-1.5 sm:py-2">
                <button
                  onClick={openCreateVehicleForm}
                  className="w-full flex items-center gap-3 px-4 py-3 sm:px-5 sm:py-4 text-left border-b border-zinc-100 dark:border-zinc-800/60 mb-1.5 sm:mb-2 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors"
                >
                  <Plus size={18} className="flex-shrink-0 text-zinc-500 dark:text-zinc-400" />
                  <div>
                    <p className="text-sm sm:text-base font-medium text-zinc-900 dark:text-white">Thêm xe</p>
                  </div>
                </button>
                {vehicles.length === 0 ? (
                  <div className="px-4 py-3 sm:px-5 sm:py-4 text-xs sm:text-sm text-zinc-400">Không tìm thấy xe nào.</div>
                ) : (
                  vehicles.map((v) => {
                    const isActive = v.id === activeVid;
                    return (
                      <div
                        key={v.id}
                        className="w-full flex items-center hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors"
                      >
                        <button
                          type="button"
                          onClick={() => {
                            if (v.id !== activeVid) {
                              setActiveVid(v.id);
                              // Hiện spinner ngay, không render lịch sử của xe trước
                              setEventsState('loading');
                            }
                            setIsMenuOpen(false);
                          }}
                          className="flex-1 min-w-0 flex items-center gap-3 sm:gap-4 px-4 py-3 sm:px-5 sm:py-4 text-left"
                        >
                          {v.vehicle_type === 'MOTORBIKE' ? (
                            <Bike size={18} className={isActive ? 'text-zinc-900 dark:text-white' : 'text-zinc-400'} />
                          ) : (
                            <Car size={18} className={isActive ? 'text-zinc-900 dark:text-white' : 'text-zinc-400'} />
                          )}
                          <div className="text-left min-w-0">
                            <p className={`text-sm sm:text-base font-medium ${isActive ? 'text-zinc-900 dark:text-white' : 'text-zinc-600 dark:text-zinc-400'}`}>{v.name}</p>
                            <div className="flex items-center gap-1.5 sm:gap-2 mt-0.5 sm:mt-1">
                              <p className="text-[11px] sm:text-xs text-zinc-400 font-mono">{v.plate}</p>
                              <span className="text-[10px] sm:text-xs text-zinc-300 dark:text-zinc-600">•</span>
                              <p className="text-[11px] sm:text-xs font-mono font-medium text-emerald-600 dark:text-emerald-500">{v.current_odo.toLocaleString('vi-VN')} km</p>
                            </div>
                          </div>
                        </button>
                        <button
                          type="button"
                          aria-label={`Chỉnh sửa ${v.name}`}
                          onClick={() => openEditVehicleForm(v)}
                          className="flex-shrink-0 mr-2 sm:mr-3 rounded-lg p-2 text-zinc-400 hover:text-zinc-900 dark:hover:text-white hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
                        >
                          <Pencil size={16} />
                        </button>
                      </div>
                    );
                  })
                )}
              </div>
            </>
          )}
        </div>
      </header>

      {/* MAIN TIMELINE CONTENT */}
      <main className="flex-1 overflow-y-auto overflow-x-hidden p-3 sm:p-4 md:p-8 bg-zinc-50 dark:bg-zinc-950 transition-colors duration-200 relative">
        <div className="max-w-4xl mx-auto pb-24 sm:pb-28 pt-4 sm:pt-6">

          {/* Lỗi tải lịch sử: vẫn giữ mốc "Sắp tới" vì mốc này tính từ dữ liệu xe */}
          {hasEventsError && activeVehicle && (
            <div className="mb-4 flex items-center justify-between gap-3 rounded-xl border border-amber-200/60 dark:border-amber-900/50 bg-amber-50 dark:bg-amber-950/30 px-3 py-2.5 text-xs sm:text-sm text-amber-700 dark:text-amber-400">
              <span>Không tải được lịch sử bảo dưỡng của xe này.</span>
              <button
                onClick={retry}
                className="font-semibold underline underline-offset-2 hover:text-amber-900 dark:hover:text-amber-300 transition-colors"
              >
                Thử lại
              </button>
            </div>
          )}

          <div className="relative py-2">
            <div className="absolute left-[80px] sm:left-[104px] md:left-[124px] top-0 bottom-0 w-1.5 md:w-2 bg-zinc-200 dark:bg-zinc-800 rounded-full"></div>

            {isLoading ? (
              <div className="flex justify-center items-center py-20 text-zinc-400 gap-2 sm:gap-3">
                <Loader2 className="animate-spin" size={20} />
                <span className="text-sm sm:text-base">Đang tải dữ liệu...</span>
              </div>
            ) : hasVehiclesError ? (
              <div className="flex flex-col items-center gap-3 py-20 text-center">
                <p className="text-sm sm:text-base text-zinc-500 dark:text-zinc-400">
                  Không tải được danh sách xe. Kiểm tra kết nối rồi thử lại.
                </p>
                <button
                  onClick={retry}
                  className="rounded-xl bg-zinc-900 dark:bg-zinc-100 px-4 py-2 text-sm font-medium text-white dark:text-zinc-900 hover:bg-zinc-800 dark:hover:bg-zinc-200 transition-colors"
                >
                  Thử lại
                </button>
              </div>
            ) : !activeVehicle ? (
              <div className="text-center py-20 text-zinc-400 text-sm sm:text-base">
                Garage chưa có xe nào. Mở menu ở trên cùng và chọn “Thêm xe” để bắt đầu.
              </div>
            ) : groupedTimeline.length === 0 ? (
              <div className="text-center py-20 text-zinc-400 text-sm sm:text-base">Chưa có dữ liệu bảo dưỡng nào cho xe này.</div>
            ) : (
              groupedTimeline.map((group) => {
                const isYearCollapsed = isYearCollapsedFor(group.year);

                return (
                  <div key={group.year} className="mb-8 sm:mb-10 last:mb-0">

                    {/* WATERMARK NĂM */}
                    <div className="relative flex items-center mb-4 sm:mb-6">
                      <div className="w-[72px] sm:w-[96px] md:w-[112px] flex-shrink-0 text-right pr-1.5 sm:pr-2 md:pr-3"></div>
                      <div className="w-2 md:w-3 flex-shrink-0"></div>

                      <div
                        className="ml-3 sm:ml-5 md:ml-8 flex-1 flex items-center gap-2 sm:gap-3 cursor-pointer group"
                        onClick={() => toggleYear(group.year)}
                      >
                        <h2 className="text-3xl sm:text-4xl md:text-5xl font-black tracking-tight text-zinc-400 dark:text-zinc-600 group-hover:text-zinc-600 dark:group-hover:text-zinc-300 transition-colors">
                          {group.year}
                        </h2>
                        <ChevronDown
                          className={`w-6 h-6 sm:w-7 sm:h-7 text-zinc-400 dark:text-zinc-600 group-hover:text-zinc-600 dark:group-hover:text-zinc-300 transition-transform duration-200 ${isYearCollapsed ? '-rotate-90' : ''}`}
                        />
                      </div>
                    </div>

                    {!isYearCollapsed && (
                      <div className="space-y-6 sm:space-y-8">
                        {group.items.map((item) => {
                          const isNearest = item.isFuture && item.isNearest;
                          const isExpanded = expandedCards.includes(item.id);

                          const cardWrapperClass = "relative border rounded-2xl shadow-sm overflow-hidden flex flex-col border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/60";

                          let iconBgClass = "bg-zinc-50 dark:bg-zinc-800 border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300";
                          if (item.event_type === 'SỬA CHỮA') {
                            iconBgClass = "bg-amber-50 dark:bg-amber-950/30 border-amber-200/50 dark:border-amber-900/50 text-amber-500 dark:text-amber-400";
                          }

                          const formattedDate = new Date(item.due_date).toLocaleDateString('vi-VN');
                          const hasItems = item.maintenance_items && item.maintenance_items.length > 0;

                          const statusBadge = item.isFuture ? null : (
                            <div className="flex items-center gap-1 sm:gap-1.5">
                              <div className="bg-emerald-500 rounded-full p-0.5 sm:p-1 flex items-center justify-center shadow-sm">
                                <Check size={10} className="text-white" strokeWidth={4} />
                              </div>
                              <span className="text-[10px] sm:text-xs md:text-sm font-medium text-emerald-600 dark:text-emerald-500">Hoàn thành</span>
                            </div>
                          );

                          return (
                            <div key={item.id} className="relative flex items-stretch">

                              {/* CỘT TRÁI */}
                              <div className="w-[72px] sm:w-[96px] md:w-[112px] flex-shrink-0 text-right pr-1.5 sm:pr-2 md:pr-3 flex flex-col items-end justify-center">
                                <span className={`inline-block text-[11px] sm:text-xs md:text-sm font-mono py-0.5 sm:py-1 rounded-md
                                  ${isNearest ? 'text-emerald-600 dark:text-emerald-500 font-bold' : 'text-zinc-600 dark:text-zinc-300 font-bold'}`}>
                                  {item.target_odo.toLocaleString('vi-VN')} km
                                </span>
                                <span className={`text-[10px] sm:text-xs mt-1 sm:mt-1.5 tracking-widest ${isNearest ? 'text-emerald-600 dark:text-emerald-500 font-bold' : 'text-zinc-400 font-medium'}`}>
                                  {formattedDate}
                                </span>
                              </div>
                              <div className="flex items-center">
                                <div className={`w-2 md:w-3 h-[2px] z-10 ${isNearest ? 'bg-emerald-500' : 'bg-zinc-300 dark:bg-zinc-700'}`}></div>
                              </div>
                              <div className="relative flex items-center justify-center w-0">
                                <div className={`absolute rounded-full z-10
                                  ${isNearest
                                    ? 'bg-emerald-500 w-3 h-3 md:w-4 md:h-4 shadow-[0_0_8px_rgba(16,185,129,0.6)]'
                                    : 'bg-zinc-400/50 dark:bg-zinc-500/50 w-2 h-2 md:w-2.5 md:h-2.5'}`}>
                                </div>
                              </div>

                              {/* CỘT PHẢI */}
                              <div className="ml-3 sm:ml-5 md:ml-8 flex-1 min-w-0 py-1">
                                <div className={`relative rounded-2xl ${isNearest ? 'neon-card' : ''}`}>
                                  <div className={cardWrapperClass}>
                                  
                                  {/* KHỐI OVERVIEW */}
                                  <div 
                                    className={`flex flex-col ${hasItems ? 'cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors group/overview' : ''}`}
                                    onClick={() => hasItems && toggleCard(item.id)}
                                  >
                                    <div className="p-3 sm:p-4 md:p-5 pb-1.5 sm:pb-2 flex gap-2.5 sm:gap-4 items-start">
                                      <div className={`mt-0.5 p-1.5 sm:p-2 rounded-xl border flex-shrink-0 h-fit ${iconBgClass}`}>
                                        {item.event_type === 'SỬA CHỮA' ? <Wrench className="w-4 h-4 sm:w-[18px] sm:h-[18px]" /> : <Settings className="w-4 h-4 sm:w-[18px] sm:h-[18px]" />}
                                      </div>

                                      <div className="flex-1 pt-0.5 min-w-0">
                                        <div className="flex justify-between items-start gap-2 sm:gap-3 w-full">
                                          <div className="flex flex-col flex-1 min-w-0">
                                            <div className="flex items-center gap-2 sm:gap-2.5 flex-wrap">
                                              {/* Title sẽ bám sát toàn bộ chiều rộng do đã gỡ thẻ span cấp độ */}
                                              <p className="font-bold text-sm sm:text-base md:text-lg text-zinc-900 dark:text-zinc-100 leading-tight">{item.title}</p>
                                            </div>

                                            {/* Location */}
                                            {item.location && (
                                              <div className="flex items-center gap-1.5 text-xs sm:text-sm text-zinc-500 dark:text-zinc-400 mt-1.5 sm:mt-2">
                                                <MapPin className="w-3.5 h-3.5 sm:w-4 sm:h-4 flex-shrink-0" />
                                                <span className="truncate">{item.location}</span>
                                              </div>
                                            )}

                                            {/* Ghi Chú */}
                                            {item.notes && (
                                              <div className="mt-2 sm:mt-3 text-xs sm:text-sm leading-relaxed text-zinc-700 dark:text-zinc-300 bg-zinc-100/50 dark:bg-zinc-800/30 px-2.5 py-2 sm:px-3 sm:py-2.5 rounded-lg border border-zinc-200/50 dark:border-zinc-700/50">
                                                <span className="font-semibold text-zinc-800 dark:text-zinc-200 mr-1.5">Ghi chú:</span>
                                                {item.notes}
                                              </div>
                                            )}
                                          </div>

                                          <div className="hidden sm:block flex-shrink-0 mt-0.5">
                                            {statusBadge}
                                          </div>
                                        </div>

                                        <div className="mt-2 sm:mt-3 w-full flex items-center justify-between gap-2 sm:block sm:text-right">
                                          {/* Hoàn thành trên mobile: cùng hàng với tổng tiền */}
                                          {!item.isFuture && (
                                            <div className="sm:hidden">{statusBadge}</div>
                                          )}
                                          <p className="ml-auto font-semibold text-zinc-900 dark:text-zinc-100 text-sm sm:text-base md:text-lg whitespace-nowrap inline-block">
                                            {!item.isFuture && item.total_cost ? `${item.total_cost.toLocaleString('vi-VN')} đ` : null}
                                          </p>
                                        </div>

                                      </div>
                                    </div>

                                    {/* Mũi tên Dropdown CHỈ HIỆN nếu có danh sách vật tư bên trong */}
                                    {hasItems && (
                                      <div className="flex justify-center items-center pb-1.5 sm:pb-2 pt-1 text-zinc-300 dark:text-zinc-600 group-hover/overview:text-zinc-500 dark:group-hover/overview:text-zinc-400 transition-colors">
                                        <ChevronDown size={20} className={`transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`} />
                                      </div>
                                    )}
                                  </div>

                                  {/* KHỐI DETAIL (Danh sách hạng mục / vật tư) */}
                                  {isExpanded && hasItems && (
                                    <div className="px-3 sm:px-4 md:px-5 pb-3 sm:pb-4 md:pb-5 border-t border-zinc-100 dark:border-zinc-800/60 bg-zinc-50/50 dark:bg-zinc-900/30">
                                      <div className="space-y-2 sm:space-y-3 pt-3 sm:pt-4">
                                        {item.maintenance_items?.map((detail) => (
                                          <div key={detail.id} className="flex justify-between text-xs sm:text-sm gap-2 sm:gap-3">
                                            <span className="text-zinc-600 dark:text-zinc-400 before:content-['•'] before:mr-2 sm:before:mr-2.5 before:text-zinc-300 flex-1">{detail.name}</span>
                                            {detail.price ? (
                                              <span className="font-medium text-zinc-700 dark:text-zinc-300 whitespace-nowrap flex-shrink-0">{detail.price.toLocaleString('vi-VN')} đ</span>
                                            ) : null}
                                          </div>
                                        ))}
                                      </div>
                                    </div>
                                  )}

                                  </div>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })
            )}

          </div>
        </div>
      </main>

      {/* FAB: ghi nhận bảo dưỡng / sửa chữa cho xe đang chọn */}
      <button
        onClick={openServiceForm}
        disabled={!activeVehicle}
        aria-label="Ghi nhận bảo dưỡng hoặc sửa chữa"
        title={
          activeVehicle
            ? 'Ghi nhận bảo dưỡng / sửa chữa'
            : 'Thêm xe trước khi ghi nhận dịch vụ'
        }
        className="fixed bottom-6 right-6 sm:bottom-8 sm:right-8 md:bottom-10 md:right-10 bg-zinc-900 hover:bg-zinc-800 active:bg-zinc-700 dark:bg-zinc-100 dark:hover:bg-zinc-200 dark:active:bg-zinc-300 text-white dark:text-zinc-900 shadow-xl rounded-full p-3.5 sm:p-4 md:p-5 flex items-center justify-center z-50 transition-colors duration-150 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-zinc-900 dark:disabled:hover:bg-zinc-100"
      >
        <Plus className="w-6 h-6 sm:w-7 sm:h-7" />
      </button>

      {/* MODAL THÊM / CHỈNH SỬA XE */}
      {vehicleFormMode && (
        <div
          className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-zinc-950/50 backdrop-blur-sm sm:p-4"
          onClick={closeVehicleForm}
        >
          <form
            onSubmit={handleVehicleSubmit}
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="vehicle-form-title"
            className="w-full sm:max-w-md max-h-[90dvh] overflow-y-auto rounded-t-2xl sm:rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-xl p-4 sm:p-6 flex flex-col gap-4"
          >
            <div className="flex items-center justify-between">
              <h2 id="vehicle-form-title" className="text-base sm:text-lg font-bold text-zinc-900 dark:text-zinc-100">
                {vehicleFormMode === 'edit' ? 'Chỉnh sửa xe' : 'Thêm xe'}
              </h2>
              <button
                type="button"
                onClick={closeVehicleForm}
                aria-label="Đóng"
                className="rounded-lg p-1.5 text-zinc-400 hover:text-zinc-900 dark:hover:text-white hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
              >
                <X size={18} />
              </button>
            </div>

            <label className="flex flex-col gap-1.5">
              <span className="text-xs sm:text-sm font-medium text-zinc-600 dark:text-zinc-400">Tên xe</span>
              <input
                type="text"
                value={vehicleFormValues.name}
                onChange={(event) => setVehicleFormValues((prev) => ({ ...prev, name: event.target.value }))}
                placeholder="VD: Camry 2023 2.0Q"
                className={FORM_FIELD_CLASS}
              />
            </label>

            <label className="flex flex-col gap-1.5">
              <span className="text-xs sm:text-sm font-medium text-zinc-600 dark:text-zinc-400">Biển số</span>
              <input
                type="text"
                value={vehicleFormValues.plate}
                onChange={(event) => setVehicleFormValues((prev) => ({ ...prev, plate: event.target.value }))}
                placeholder="VD: 51H-123.45"
                className={FORM_FIELD_CLASS}
              />
            </label>

            <label className="flex flex-col gap-1.5">
              <span className="text-xs sm:text-sm font-medium text-zinc-600 dark:text-zinc-400">ODO hiện tại (km)</span>
              <input
                type="number"
                inputMode="numeric"
                min={0}
                step={1}
                value={vehicleFormValues.current_odo}
                onChange={(event) => setVehicleFormValues((prev) => ({ ...prev, current_odo: event.target.value }))}
                placeholder="VD: 15070"
                className={FORM_FIELD_CLASS}
              />
            </label>

            <fieldset className="flex flex-col border-0 p-0 m-0">
              <legend className="text-xs sm:text-sm font-medium text-zinc-600 dark:text-zinc-400 mb-1.5">Loại xe</legend>
              <div className="grid grid-cols-2 gap-2">
                {(['CAR', 'MOTORBIKE'] as const).map((type) => {
                  const isSelected = vehicleFormValues.vehicle_type === type;
                  return (
                    <button
                      key={type}
                      type="button"
                      aria-pressed={isSelected}
                      onClick={() => setVehicleFormValues((prev) => ({ ...prev, vehicle_type: type }))}
                      className={`flex items-center justify-center gap-2 rounded-xl border px-3 py-2 text-sm font-medium transition-colors ${
                        isSelected
                          ? 'border-emerald-500 bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400'
                          : 'border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800'
                      }`}
                    >
                      {type === 'CAR' ? <Car size={16} /> : <Bike size={16} />}
                      {type === 'CAR' ? 'Ô tô' : 'Xe máy'}
                    </button>
                  );
                })}
              </div>
            </fieldset>

            {vehicleFormError && (
              <p className="rounded-lg border border-red-200/60 dark:border-red-900/50 bg-red-50 dark:bg-red-950/30 px-3 py-2 text-xs sm:text-sm text-red-600 dark:text-red-400">
                {vehicleFormError}
              </p>
            )}

            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={closeVehicleForm}
                disabled={isSavingVehicle}
                className="rounded-xl px-4 py-2 text-sm font-medium text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-50 transition-colors"
              >
                Hủy
              </button>
              <button
                type="submit"
                disabled={isSavingVehicle}
                className="inline-flex items-center gap-2 rounded-xl bg-zinc-900 dark:bg-zinc-100 px-4 py-2 text-sm font-semibold text-white dark:text-zinc-900 hover:bg-zinc-800 dark:hover:bg-zinc-200 disabled:opacity-60 transition-colors"
              >
                {isSavingVehicle && <Loader2 size={16} className="animate-spin" />}
                {vehicleFormMode === 'edit' ? 'Lưu thay đổi' : 'Thêm xe'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* MODAL GHI NHẬN BẢO DƯỠNG / SỬA CHỮA */}
      {serviceForm && activeVehicle && (
        <div
          className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-zinc-950/50 backdrop-blur-sm sm:p-4"
          onClick={closeServiceForm}
        >
          <form
            onSubmit={handleServiceSubmit}
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="service-form-title"
            className="w-full sm:max-w-lg max-h-[90dvh] overflow-y-auto rounded-t-2xl sm:rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-xl p-4 sm:p-6 flex flex-col gap-4"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 id="service-form-title" className="text-base sm:text-lg font-bold text-zinc-900 dark:text-zinc-100">
                  Ghi nhận dịch vụ
                </h2>
                <p className="mt-1 text-xs sm:text-sm text-zinc-500 dark:text-zinc-400 truncate">
                  {activeVehicle.name}
                  <span className="mx-1.5 text-zinc-300 dark:text-zinc-600">•</span>
                  {activeVehicle.plate}
                </p>
              </div>
              <button
                type="button"
                onClick={closeServiceForm}
                aria-label="Đóng"
                className="rounded-lg p-1.5 text-zinc-400 hover:text-zinc-900 dark:hover:text-white hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
              >
                <X size={18} />
              </button>
            </div>

            <fieldset className="flex flex-col border-0 p-0 m-0">
              <legend className="text-xs sm:text-sm font-medium text-zinc-600 dark:text-zinc-400 mb-1.5">Loại dịch vụ</legend>
              <div className="grid grid-cols-2 gap-2">
                {SERVICE_EVENT_TYPES.map((option) => {
                  const isSelected = serviceForm.event_type === option.value;
                  return (
                    <button
                      key={option.value}
                      type="button"
                      aria-pressed={isSelected}
                      onClick={() => updateServiceForm({ event_type: option.value })}
                      className={`flex items-center justify-center gap-2 rounded-xl border px-3 py-2 text-sm font-medium transition-colors ${
                        isSelected
                          ? 'border-emerald-500 bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400'
                          : 'border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800'
                      }`}
                    >
                      {option.value === 'SỬA CHỮA' ? <Wrench size={16} /> : <Settings size={16} />}
                      {option.label}
                    </button>
                  );
                })}
              </div>
            </fieldset>

            {serviceForm.event_type === 'BẢO DƯỠNG' ? (
              <fieldset className="flex flex-col border-0 p-0 m-0">
                <legend className="text-xs sm:text-sm font-medium text-zinc-600 dark:text-zinc-400 mb-1.5">Mốc bảo dưỡng</legend>
                <div className="grid grid-cols-2 gap-2">
                  {MAINTENANCE_TIERS.map((option) => {
                    const isSelected = serviceForm.maintenance_tier === option.value;
                    return (
                      <button
                        key={option.value}
                        type="button"
                        aria-pressed={isSelected}
                        onClick={() => updateServiceForm({ maintenance_tier: option.value })}
                        className={`rounded-xl border px-3 py-2 text-sm font-medium transition-colors ${
                          isSelected
                            ? 'border-emerald-500 bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400'
                            : 'border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800'
                        }`}
                      >
                        {option.label}
                      </button>
                    );
                  })}
                </div>
                <p className="mt-1.5 text-[11px] sm:text-xs text-zinc-400 dark:text-zinc-500">
                  Tiêu đề sự kiện: {maintenanceTitle(serviceForm.maintenance_tier)}
                </p>
              </fieldset>
            ) : (
              <label className="flex flex-col gap-1.5">
                <span className="text-xs sm:text-sm font-medium text-zinc-600 dark:text-zinc-400">Nội dung sửa chữa</span>
                <input
                  type="text"
                  value={serviceForm.title}
                  onChange={(event) => updateServiceForm({ title: event.target.value })}
                  placeholder="VD: Thay má phanh trước"
                  className={FORM_FIELD_CLASS}
                />
              </label>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="flex flex-col gap-1.5">
                <span className="text-xs sm:text-sm font-medium text-zinc-600 dark:text-zinc-400">Nơi làm dịch vụ</span>
                <input
                  type="text"
                  value={serviceForm.location}
                  onChange={(event) => updateServiceForm({ location: event.target.value })}
                  placeholder="VD: Garage Toyota Mỹ Đình"
                  className={FORM_FIELD_CLASS}
                />
              </label>

              <div className="flex flex-col gap-1.5">
                <span className="text-xs sm:text-sm font-medium text-zinc-600 dark:text-zinc-400">Ngày làm</span>
                <button
                  type="button"
                  onClick={toggleServiceDatePicker}
                  aria-expanded={serviceDatePickerMonth !== null}
                  aria-label="Chọn ngày làm"
                  className={`${FORM_FIELD_CLASS} flex items-center justify-between gap-2 text-left`}
                >
                  <span>{formatDateDisplay(serviceForm.due_date)}</span>
                  <CalendarDays size={16} className="shrink-0 text-zinc-400" />
                </button>

                {serviceDatePickerMonth && (
                  <div ref={serviceDatePickerRef}>
                    <ServiceDatePicker
                      value={serviceForm.due_date}
                      maxDate={serviceForm.max_date}
                      month={serviceDatePickerMonth}
                      onChangeMonth={setServiceDatePickerMonth}
                      onSelect={selectServiceDate}
                    />
                  </div>
                )}
              </div>
            </div>

            <label className="flex flex-col gap-1.5">
              <span className="text-xs sm:text-sm font-medium text-zinc-600 dark:text-zinc-400">ODO khi làm (km)</span>
              <input
                type="number"
                inputMode="numeric"
                min={0}
                step={1}
                value={serviceForm.target_odo}
                onChange={(event) => updateServiceForm({ target_odo: event.target.value })}
                placeholder={`VD: ${activeVehicle.current_odo}`}
                className={FORM_FIELD_CLASS}
              />
              <span className="text-[11px] sm:text-xs text-zinc-400 dark:text-zinc-500">
                ODO hiện tại của xe: {activeVehicle.current_odo.toLocaleString('vi-VN')} km
                {willUpdateVehicleOdo ? ' • sẽ cập nhật ODO của xe sau khi lưu.' : ''}
              </span>
            </label>

            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs sm:text-sm font-medium text-zinc-600 dark:text-zinc-400">Các mục thực hiện</span>
                <span className="text-xs sm:text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                  Tổng: {serviceFormTotal.toLocaleString('vi-VN')} đ
                </span>
              </div>

              <div className="flex flex-col gap-2">
                {serviceForm.items.map((item) => (
                  <div key={item.key} className="flex items-start gap-2">
                    <input
                      type="text"
                      value={item.name}
                      onChange={(event) => updateServiceItem(item.key, { name: event.target.value })}
                      placeholder="VD: Thay dầu máy"
                      aria-label="Tên mục thực hiện"
                      className={`${FORM_FIELD_CLASS} min-w-0`}
                    />
                    <div className="relative w-28 sm:w-32 flex-shrink-0">
                      <input
                        type="number"
                        inputMode="numeric"
                        min={0}
                        step={1}
                        value={item.price}
                        onChange={(event) => updateServiceItem(item.key, { price: event.target.value })}
                        placeholder="0"
                        aria-label="Giá tiền của mục (đ)"
                        className={`${FORM_FIELD_CLASS} pr-7`}
                      />
                      <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-zinc-400">đ</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => removeServiceItem(item.key)}
                      disabled={serviceForm.items.length === 1}
                      aria-label="Xóa mục"
                      title="Xóa mục"
                      className="flex-shrink-0 rounded-lg p-2 text-zinc-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-zinc-400 transition-colors"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                ))}
              </div>

              <button
                type="button"
                onClick={addServiceItem}
                className="inline-flex items-center justify-center gap-1.5 self-start rounded-xl border border-dashed border-zinc-300 dark:border-zinc-700 px-3 py-1.5 text-xs sm:text-sm font-medium text-zinc-600 dark:text-zinc-300 hover:border-emerald-500 hover:text-emerald-600 dark:hover:text-emerald-400 transition-colors"
              >
                <Plus size={14} />
                Thêm mục
              </button>
            </div>
            <label className="flex flex-col gap-1.5">
              <span className="text-xs sm:text-sm font-medium text-zinc-600 dark:text-zinc-400">Ghi chú</span>
              <textarea
                value={serviceForm.notes}
                onChange={(event) => updateServiceForm({ notes: event.target.value })}
                rows={3}
                placeholder="VD: Xe chạy êm hơn sau khi thay dầu, hẹn quay lại ở mốc 20.000 km."
                className={`${FORM_FIELD_CLASS} resize-y`}
              />
            </label>

            {serviceFormError && (
              <p className="rounded-lg border border-red-200/60 dark:border-red-900/50 bg-red-50 dark:bg-red-950/30 px-3 py-2 text-xs sm:text-sm text-red-600 dark:text-red-400">
                {serviceFormError}
              </p>
            )}

            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={closeServiceForm}
                disabled={isSavingService}
                className="rounded-xl px-4 py-2 text-sm font-medium text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-50 transition-colors"
              >
                Hủy
              </button>
              <button
                type="submit"
                disabled={isSavingService}
                className="inline-flex items-center gap-2 rounded-xl bg-zinc-900 dark:bg-zinc-100 px-4 py-2 text-sm font-semibold text-white dark:text-zinc-900 hover:bg-zinc-800 dark:hover:bg-zinc-200 disabled:opacity-60 transition-colors"
              >
                {isSavingService && <Loader2 size={16} className="animate-spin" />}
                Lưu
              </button>
            </div>
          </form>
        </div>
      )}

    </div>
  );
}
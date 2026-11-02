'use client';

import { startTransition, useEffect, useState } from 'react';
import { Car, Bike, Wrench, AlertTriangle, Plus, ChevronDown, Check, Loader2 } from 'lucide-react';
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
  price: number;
}

export interface MaintenanceEvent {
  id: string;
  vehicle_id: string;
  title: string;
  event_type: 'BẢO DƯỠNG' | 'SỬA CHỮA';
  maintenance_tier?: MaintenanceTier;
  target_odo: number;
  due_date: string;
  // Đã gỡ bỏ is_upcoming ở đây
  is_critical: boolean;
  total_cost: number;
  maintenance_items?: MaintenanceItem[];
}

// Hàm tính toán động mốc bảo dưỡng tiếp theo dựa vào ODO hiện tại
function generateNextMilestone(currentOdo: number, type: 'CAR' | 'MOTORBIKE') {
  const step = type === 'CAR' ? 5000 : 2000;
  // Nội suy mốc chẵn tiếp theo (VD: 39500 -> 40000)
  const nextOdo = Math.floor(currentOdo / step) * step + step;

  let tier: MaintenanceTier = 'CẤP NHỎ';
  let estimatedCost = 0;
  let defaultItems: { name: string; price: number }[] = [];

  if (type === 'CAR') {
    if (nextOdo % 40000 === 0) {
      tier = 'CẤP LỚN';
      estimatedCost = 4500000;
      defaultItems = [{ name: 'Thay dầu hộp số', price: 1500000 }, { name: 'Thay nước mát', price: 400000 }, { name: 'Dầu máy & Lọc', price: 1050000 }];
    } else if (nextOdo % 20000 === 0) {
      tier = 'CẤP TRUNG BÌNH LỚN';
      estimatedCost = 2500000;
      defaultItems = [{ name: 'Bảo dưỡng phanh', price: 400000 }, { name: 'Vệ sinh kim phun', price: 600000 }, { name: 'Dầu máy & Lọc', price: 1050000 }];
    } else if (nextOdo % 10000 === 0) {
      tier = 'CẤP TRUNG BÌNH';
      estimatedCost = 1500000;
      defaultItems = [{ name: 'Đảo lốp', price: 150000 }, { name: 'Dầu máy & Lọc', price: 1050000 }];
    } else {
      tier = 'CẤP NHỎ';
      estimatedCost = 900000;
      defaultItems = [{ name: 'Thay dầu máy', price: 800000 }, { name: 'Công thợ', price: 100000 }];
    }
  } else {
    if (nextOdo % 10000 === 0) {
      tier = 'CẤP LỚN';
      estimatedCost = 1200000;
      defaultItems = [{ name: 'Vệ sinh buồng đốt', price: 200000 }, { name: 'Bảo dưỡng nồi/nhông xích', price: 300000 }];
    } else if (nextOdo % 6000 === 0) {
      tier = 'CẤP TRUNG BÌNH';
      estimatedCost = 500000;
      defaultItems = [{ name: 'Thay lọc gió', price: 150000 }, { name: 'Thay dầu máy', price: 200000 }];
    } else {
      tier = 'CẤP NHỎ';
      estimatedCost = 250000;
      defaultItems = [{ name: 'Thay dầu máy', price: 200000 }];
    }
  }

  return {
    id: 'virtual-upcoming-event',
    title: `Bảo dưỡng định kỳ ${nextOdo.toLocaleString('vi-VN')} km`,
    event_type: 'BẢO DƯỠNG' as const,
    maintenance_tier: tier,
    target_odo: nextOdo,
    due_date: new Date().toISOString(), 
    isFuture: true,
    isNearest: true,
    total_cost: estimatedCost,
    maintenance_items: defaultItems.map((item, idx) => ({ id: `v-item-${idx}`, ...item }))
  };
}

export default function Dashboard() {
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [activeVid, setActiveVid] = useState<string>('');
  const [events, setEvents] = useState<MaintenanceEvent[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [expandedCards, setExpandedCards] = useState<string[]>([]);
  const [collapsedYears, setCollapsedYears] = useState<string[]>([]);

  // 1. Fetch danh sách xe
  useEffect(() => {
    async function fetchVehicles() {
      try {
        const { data, error } = await supabase
          .from('vehicles')
          .select('*')
          .order('created_at', { ascending: true });
        
        if (error) throw error;

        if (data && data.length > 0) {
          // Ưu tiên xe ô tô: CAR đứng trước MOTORBIKE, giữ nguyên thứ tự created_at trong từng nhóm.
          const sortedVehicles = [...data].sort(
            (a: Vehicle, b: Vehicle) =>
              (a.vehicle_type === 'CAR' ? 0 : 1) - (b.vehicle_type === 'CAR' ? 0 : 1)
          );

          setVehicles(sortedVehicles);
          setActiveVid(sortedVehicles[0].id);
        }
      } catch (err) {
        console.error('Lỗi khi tải danh sách xe:', err);
      }
    }
    fetchVehicles();
  }, []);

  // 2. Fetch danh sách sự kiện ĐÃ HOÀN THÀNH từ Database (Gỡ bỏ cột is_upcoming)
  useEffect(() => {
    if (!activeVid) return;

    async function fetchMaintenanceEvents() {
      setIsLoading(true);
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
            maintenance_items (
              id,
              name,
              price
            )
          `)
          .eq('vehicle_id', activeVid)
          .order('target_odo', { ascending: false });

        if (error) throw error;

        if (data) {
          setEvents(data as unknown as MaintenanceEvent[]);
        }
      } catch (err) {
        console.error('Lỗi khi tải sự kiện bảo dưỡng:', err);
      } finally {
        setIsLoading(false);
      }
    }

    fetchMaintenanceEvents();
  }, [activeVid]);

  const activeVehicle = vehicles.find((v) => v.id === activeVid);

  const toggleCard = (id: string) => {
    setExpandedCards((prev) =>
      prev.includes(id) ? prev.filter((cardId) => cardId !== id) : [...prev, id]
    );
  };

  const toggleYear = (year: string) => {
    setCollapsedYears((prev) =>
      prev.includes(year) ? prev.filter((y) => y !== year) : [...prev, year]
    );
  };

  // Vì DB giờ chỉ lưu Lịch sử (Quá khứ), ta sort toàn bộ data trả về
  const pastEvents = [...events].sort((a, b) => b.target_odo - a.target_odo);

  // Khởi tạo Event tương lai bằng hàm tự động
  const virtualUpcomingEvent = activeVehicle 
    ? generateNextMilestone(activeVehicle.current_odo, activeVehicle.vehicle_type) 
    : null;

  // Ghép Timeline: Tương lai lên đầu, Lịch sử xuống dưới
  const unifiedTimeline = [
    ...(virtualUpcomingEvent ? [virtualUpcomingEvent] : []),
    ...pastEvents.map((h) => ({ ...h, isFuture: false, isNearest: false }))
  ];

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

  // Mặc định mở rộng năm hiện tại và năm trước; các năm còn lại thu gọn.
  const timelineYearsKey = groupedTimeline.map((group) => group.year).join(',');

  useEffect(() => {
    const currentYear = new Date().getFullYear();
    const collapsed = timelineYearsKey
      ? timelineYearsKey.split(',').filter((year) => {
          const yearNumber = parseInt(year, 10);
          return (
            !isNaN(yearNumber) &&
            yearNumber !== currentYear &&
            yearNumber !== currentYear - 1
          );
        })
      : [];

    startTransition(() => setCollapsedYears(collapsed));
  }, [timelineYearsKey]);

  return (
    <div className="flex flex-col h-[100dvh] bg-zinc-50 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 font-sans transition-colors duration-200 relative">
      
      {/* HEADER DROPDOWN */}
      <header className="flex-shrink-0 border-b border-zinc-200 dark:border-zinc-800/60 bg-white dark:bg-zinc-950 px-4 py-3 flex items-center justify-center z-20 relative shadow-sm">
        <div className="relative">
          <button 
            onClick={() => setIsMenuOpen(!isMenuOpen)}
            className="flex items-center gap-3 px-2 py-1.5 -ml-2 rounded-xl hover:bg-zinc-100 dark:hover:bg-zinc-900 transition-colors"
          >
            <div className="bg-zinc-100 dark:bg-zinc-800 p-2 rounded-lg text-zinc-600 dark:text-zinc-300">
              {activeVehicle?.vehicle_type === 'MOTORBIKE' ? <Bike size={20} /> : <Car size={20} />}
            </div>
            <div className="text-left flex flex-col justify-center">
              <p className="font-bold text-sm leading-tight text-zinc-900 dark:text-zinc-100">
                {activeVehicle ? activeVehicle.name : 'Đang tải xe...'}
              </p>
              {activeVehicle && (
                <div className="flex items-center gap-1.5 mt-0.5">
                  <span className="text-[10px] uppercase font-semibold text-zinc-500">ODO</span>
                  <span className="text-xs font-mono font-bold text-emerald-600 dark:text-emerald-500">
                    {activeVehicle.current_odo.toLocaleString('vi-VN')} km
                  </span>
                </div>
              )}
            </div>
            <ChevronDown size={16} className={`ml-1 text-zinc-400 transition-transform duration-200 ${isMenuOpen ? 'rotate-180' : ''}`} />
          </button>

          {isMenuOpen && (
            <>
              <div className="fixed inset-0 z-30" onClick={() => setIsMenuOpen(false)}></div>
              <div className="absolute top-full left-1/2 -translate-x-1/2 mt-2 w-72 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800/60 rounded-2xl shadow-xl z-40 overflow-hidden py-1.5">
                <div className="px-4 py-2 border-b border-zinc-100 dark:border-zinc-800/60 mb-1">
                  <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">Garage của bạn</p>
                </div>
                {vehicles.length === 0 ? (
                  <div className="px-4 py-3 text-xs text-zinc-400">Không tìm thấy xe nào.</div>
                ) : (
                  vehicles.map((v) => {
                    const isActive = v.id === activeVid;
                    return (
                      <button 
                        key={v.id} 
                        onClick={() => { setActiveVid(v.id); setIsMenuOpen(false); }}
                        className="w-full flex items-center justify-between px-4 py-3 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors"
                      >
                        <div className="flex items-center gap-3">
                          {v.vehicle_type === 'MOTORBIKE' ? (
                            <Bike size={18} className={isActive ? 'text-zinc-900 dark:text-white' : 'text-zinc-400'} />
                          ) : (
                            <Car size={18} className={isActive ? 'text-zinc-900 dark:text-white' : 'text-zinc-400'} />
                          )}
                          <div className="text-left">
                            <p className={`text-sm font-medium ${isActive ? 'text-zinc-900 dark:text-white' : 'text-zinc-600 dark:text-zinc-400'}`}>{v.name}</p>
                            <div className="flex items-center gap-2 mt-0.5">
                              <p className="text-[11px] text-zinc-400 font-mono">{v.plate}</p>
                              <span className="text-[10px] text-zinc-300 dark:text-zinc-600">•</span>
                              <p className="text-[11px] font-mono font-medium text-emerald-600 dark:text-emerald-500">{v.current_odo.toLocaleString('vi-VN')} km</p>
                            </div>
                          </div>
                        </div>
                        {isActive && <Check size={18} className="text-zinc-900 dark:text-white" />}
                      </button>
                    );
                  })
                )}
              </div>
            </>
          )}
        </div>
      </header>

      {/* MAIN TIMELINE CONTENT */}
      <main className="flex-1 overflow-y-auto p-4 md:p-8 bg-zinc-50 dark:bg-zinc-950 transition-colors duration-200 relative">
        <div className="max-w-3xl mx-auto pb-24 pt-4">
          
          <div className="relative py-2">
            <div className="absolute left-[92px] md:left-[104px] top-0 bottom-0 w-1.5 md:w-2 bg-zinc-200 dark:bg-zinc-800 rounded-full"></div>

            {isLoading ? (
              <div className="flex justify-center items-center py-20 text-zinc-400 gap-2">
                <Loader2 className="animate-spin" size={20} />
                <span className="text-sm">Đang tải dữ liệu...</span>
              </div>
            ) : groupedTimeline.length === 0 ? (
              <div className="text-center py-20 text-zinc-400 text-sm">Chưa có dữ liệu bảo dưỡng nào cho xe này.</div>
            ) : (
              groupedTimeline.map((group) => {
                const isYearCollapsed = collapsedYears.includes(group.year);

                return (
                  <div key={group.year} className="mb-8 last:mb-0">
                    
                    {/* WATERMARK NĂM */}
                    <div className="relative flex items-center mb-5">
                      <div className="w-[84px] md:w-[96px] flex-shrink-0 text-right pr-2 md:pr-3"></div>
                      <div className="w-2 md:w-3 flex-shrink-0"></div>
                      
                      <div 
                        className="ml-4 md:ml-6 flex-1 flex items-center gap-2 cursor-pointer group"
                        onClick={() => toggleYear(group.year)}
                      >
                        <h2 className="text-3xl md:text-4xl font-black tracking-tight text-zinc-400 dark:text-zinc-600 group-hover:text-zinc-600 dark:group-hover:text-zinc-300 transition-colors">
                          {group.year}
                        </h2>
                        <ChevronDown 
                          size={24} 
                          className={`text-zinc-400 dark:text-zinc-600 group-hover:text-zinc-600 dark:group-hover:text-zinc-300 transition-transform duration-200 ${isYearCollapsed ? '-rotate-90' : ''}`} 
                        />
                      </div>
                    </div>

                    {!isYearCollapsed && (
                      <div className="space-y-6">
                        {group.items.map((item) => {
                          const isNearest = item.isFuture && item.isNearest;
                          const isExpanded = expandedCards.includes(item.id);
                          
                          let cardWrapperClass = "border rounded-xl shadow-sm overflow-hidden flex flex-col ";
                          cardWrapperClass += isNearest 
                            ? "border-emerald-200 dark:border-emerald-900/50 bg-emerald-50/80 dark:bg-emerald-950/30" 
                            : "border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/60";

                          let iconBgClass = "bg-zinc-50 dark:bg-zinc-800 border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300";
                          if (isNearest) {
                            iconBgClass = "bg-emerald-100 dark:bg-emerald-900/50 border-emerald-200 dark:border-emerald-800 text-emerald-600 dark:text-emerald-400";
                          } else if (item.event_type === 'SỬA CHỮA') {
                            iconBgClass = "bg-red-50 dark:bg-red-950/30 border-red-100 dark:border-red-900/50 text-red-600";
                          }

                          const formattedDate = new Date(item.due_date).toLocaleDateString('vi-VN');

                          return (
                            <div key={item.id} className="relative flex items-stretch">
                              
                              {/* CỘT TRÁI */}
                              <div className="w-[84px] md:w-[96px] flex-shrink-0 text-right pr-2 md:pr-3 flex flex-col items-end justify-center">
                                <span className={`inline-block text-[11px] md:text-xs font-mono py-0.5 rounded-md
                                  ${isNearest ? 'text-emerald-600 dark:text-emerald-500 font-bold' : 'text-zinc-600 dark:text-zinc-300 font-bold'}`}>
                                  {item.target_odo.toLocaleString('vi-VN')} km
                                </span>
                                <span className={`text-[10px] mt-1 tracking-widest ${isNearest ? 'text-emerald-600 dark:text-emerald-500 font-bold' : 'text-zinc-400 font-semibold'}`}>
                                  {formattedDate}
                                </span>
                              </div>
                              <div className="flex items-center">
                                <div className={`w-2 md:w-3 h-[2px] z-10 ${isNearest ? 'bg-emerald-500' : 'bg-zinc-300 dark:bg-zinc-700'}`}></div>
                              </div>
                              <div className="relative flex items-center justify-center w-0">
                                <div className={`absolute rounded-full z-10 
                                  ${isNearest 
                                    ? 'bg-emerald-500 w-2.5 h-2.5 md:w-3 md:h-3 shadow-[0_0_8px_rgba(16,185,129,0.6)]' 
                                    : 'bg-zinc-400/50 dark:bg-zinc-500/50 w-1.5 h-1.5 md:w-2 md:h-2'}`}>
                                </div>
                              </div>

                              {/* CỘT PHẢI */}
                              <div className="ml-4 md:ml-6 flex-1 py-1">
                                <div className={cardWrapperClass}>
                                  
                                  {/* KHỐI OVERVIEW */}
                                  <div 
                                    className="flex flex-col cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors group/overview"
                                    onClick={() => toggleCard(item.id)}
                                  >
                                    <div className="p-3 md:p-4 pb-1 flex gap-3 items-start">
                                      <div className={`mt-0.5 p-1.5 rounded-lg border flex-shrink-0 h-fit ${iconBgClass}`}>
                                        {item.event_type === 'SỬA CHỮA' ? <AlertTriangle size={14} /> : <Wrench size={14} />}
                                      </div>
                                      
                                      <div className="flex-1 pt-0.5 min-w-0">
                                        <div className="flex justify-between items-start gap-2 w-full">
                                          <div className="flex items-center gap-2 flex-wrap flex-1">
                                            {isNearest && <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></div>}
                                            <p className="font-bold text-sm text-zinc-900 dark:text-zinc-100 leading-tight">{item.title}</p>

                                            {/* Hiển thị tag Cấp độ bảo dưỡng */}
                                            {item.maintenance_tier && (
                                              <span className="inline-block text-[10px] uppercase font-bold text-zinc-600 dark:text-zinc-300 bg-zinc-100 dark:bg-zinc-800 px-1.5 py-0.5 rounded">
                                                {item.maintenance_tier}
                                              </span>
                                            )}
                                          </div>

                                          {item.isFuture ? (
                                            <span className="inline-block flex-shrink-0 mt-0.5 text-[10px] uppercase font-bold text-emerald-600 dark:text-emerald-500 bg-emerald-100/50 dark:bg-emerald-900/30 px-1.5 py-0.5 rounded">Sắp tới</span>
                                          ) : (
                                            <div className="flex items-center gap-1.5 flex-shrink-0 mt-0.5">
                                              <div className="bg-emerald-500 rounded-full p-[2px] flex items-center justify-center shadow-sm">
                                                <Check size={10} className="text-white" strokeWidth={4} />
                                              </div>
                                              <span className="text-[11px] font-medium text-emerald-600 dark:text-emerald-500">Hoàn thành</span>
                                            </div>
                                          )}
                                        </div>

                                        <div className="mt-2 w-full text-right">
                                          <p className="font-semibold text-zinc-900 dark:text-zinc-100 text-sm whitespace-nowrap inline-block">
                                            {item.total_cost ? `${item.total_cost.toLocaleString('vi-VN')} đ` : <span className="text-zinc-400 font-normal italic">Đang cập nhật...</span>}
                                          </p>
                                        </div>

                                      </div>
                                    </div>

                                    <div className="flex justify-center items-center pb-1.5 pt-0.5 text-zinc-300 dark:text-zinc-600 group-hover/overview:text-zinc-500 dark:group-hover/overview:text-zinc-400 transition-colors">
                                      <ChevronDown size={18} className={`transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`} />
                                    </div>
                                  </div>
                                  
                                  {/* KHỐI DETAIL */}
                                  {isExpanded && item.maintenance_items && item.maintenance_items.length > 0 && (
                                    <div className="px-3 md:px-4 pb-3 md:pb-4 border-t border-zinc-100 dark:border-zinc-800/60 bg-zinc-50/50 dark:bg-zinc-900/30">
                                      <div className="space-y-2 pt-3">
                                        {item.maintenance_items.map((detail) => (
                                          <div key={detail.id} className="flex justify-between text-xs gap-2">
                                            <span className="text-zinc-600 dark:text-zinc-400 truncate before:content-['•'] before:mr-2 before:text-zinc-300">{detail.name}</span>
                                            <span className="font-medium text-zinc-700 dark:text-zinc-300 whitespace-nowrap">{detail.price?.toLocaleString('vi-VN')} đ</span>
                                          </div>
                                        ))}
                                      </div>
                                    </div>
                                  )}

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

      {/* FAB */}
      <button className="fixed bottom-6 right-6 md:bottom-8 md:right-8 bg-zinc-900 hover:bg-zinc-800 active:bg-zinc-700 dark:bg-zinc-100 dark:hover:bg-zinc-200 dark:active:bg-zinc-300 text-white dark:text-zinc-900 shadow-xl rounded-full p-4 flex items-center justify-center z-50 transition-colors duration-150">
        <Plus size={24} />
      </button>

    </div>
  );
}
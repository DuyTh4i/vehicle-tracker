'use client';

import { startTransition, useEffect, useState } from 'react';
import { Car, Bike, Wrench, Settings, Plus, ChevronDown, Check, Loader2, MapPin } from 'lucide-react';
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
  const [isLoading, setIsLoading] = useState<boolean>(true);
  
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [expandedCards, setExpandedCards] = useState<string[]>([]);
  const [collapsedYears, setCollapsedYears] = useState<string[]>([]);

  useEffect(() => {
    async function fetchVehicles() {
      try {
        const { data, error } = await supabase
          .from('vehicles')
          .select('*')
          .order('created_at', { ascending: true });
        
        if (error) throw error;

        if (data && data.length > 0) {
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

  const pastEvents = [...events].sort((a, b) => b.target_odo - a.target_odo);
  
  const lastMaintenance = pastEvents.find(e => e.event_type === 'BẢO DƯỠNG');

  const virtualUpcomingEvent = activeVehicle 
    ? generateNextMilestone(activeVehicle.current_odo, activeVehicle.vehicle_type, lastMaintenance?.due_date) 
    : null;

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
      <header className="flex-shrink-0 border-b border-zinc-200 dark:border-zinc-800/60 bg-white dark:bg-zinc-950 px-5 py-4 flex items-center justify-center z-20 relative shadow-sm">
        <div className="relative">
          <button 
            onClick={() => setIsMenuOpen(!isMenuOpen)}
            className="flex items-center gap-4 px-3 py-2 -ml-3 rounded-xl hover:bg-zinc-100 dark:hover:bg-zinc-900 transition-colors"
          >
            <div className="bg-zinc-100 dark:bg-zinc-800 p-2.5 rounded-lg text-zinc-600 dark:text-zinc-300">
              {activeVehicle?.vehicle_type === 'MOTORBIKE' ? <Bike size={24} /> : <Car size={24} />}
            </div>
            <div className="text-left flex flex-col justify-center">
              <p className="font-bold text-base leading-tight text-zinc-900 dark:text-zinc-100">
                {activeVehicle ? activeVehicle.name : 'Đang tải xe...'}
              </p>
              {activeVehicle && (
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-xs uppercase font-semibold text-zinc-500">ODO</span>
                  <span className="text-sm font-mono font-bold text-emerald-600 dark:text-emerald-500">
                    {activeVehicle.current_odo.toLocaleString('vi-VN')} km
                  </span>
                </div>
              )}
            </div>
            <ChevronDown size={20} className={`ml-2 text-zinc-400 transition-transform duration-200 ${isMenuOpen ? 'rotate-180' : ''}`} />
          </button>

          {isMenuOpen && (
            <>
              <div className="fixed inset-0 z-30" onClick={() => setIsMenuOpen(false)}></div>
              <div className="absolute top-full left-1/2 -translate-x-1/2 mt-3 w-80 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800/60 rounded-2xl shadow-xl z-40 overflow-hidden py-2">
                <div className="px-5 py-3 border-b border-zinc-100 dark:border-zinc-800/60 mb-2">
                  <p className="text-sm font-semibold text-zinc-500 uppercase tracking-wider">Garage của bạn</p>
                </div>
                {vehicles.length === 0 ? (
                  <div className="px-5 py-4 text-sm text-zinc-400">Không tìm thấy xe nào.</div>
                ) : (
                  vehicles.map((v) => {
                    const isActive = v.id === activeVid;
                    return (
                      <button 
                        key={v.id} 
                        onClick={() => { setActiveVid(v.id); setIsMenuOpen(false); }}
                        className="w-full flex items-center justify-between px-5 py-4 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors"
                      >
                        <div className="flex items-center gap-4">
                          {v.vehicle_type === 'MOTORBIKE' ? (
                            <Bike size={20} className={isActive ? 'text-zinc-900 dark:text-white' : 'text-zinc-400'} />
                          ) : (
                            <Car size={20} className={isActive ? 'text-zinc-900 dark:text-white' : 'text-zinc-400'} />
                          )}
                          <div className="text-left">
                            <p className={`text-base font-medium ${isActive ? 'text-zinc-900 dark:text-white' : 'text-zinc-600 dark:text-zinc-400'}`}>{v.name}</p>
                            <div className="flex items-center gap-2 mt-1">
                              <p className="text-xs text-zinc-400 font-mono">{v.plate}</p>
                              <span className="text-xs text-zinc-300 dark:text-zinc-600">•</span>
                              <p className="text-xs font-mono font-medium text-emerald-600 dark:text-emerald-500">{v.current_odo.toLocaleString('vi-VN')} km</p>
                            </div>
                          </div>
                        </div>
                        {isActive && <Check size={20} className="text-zinc-900 dark:text-white" />}
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
        <div className="max-w-4xl mx-auto pb-28 pt-6">
          
          <div className="relative py-2">
            <div className="absolute left-[104px] md:left-[120px] top-0 bottom-0 w-1.5 md:w-2 bg-zinc-200 dark:bg-zinc-800 rounded-full"></div>

            {isLoading ? (
              <div className="flex justify-center items-center py-20 text-zinc-400 gap-3">
                <Loader2 className="animate-spin" size={24} />
                <span className="text-base">Đang tải dữ liệu...</span>
              </div>
            ) : groupedTimeline.length === 0 ? (
              <div className="text-center py-20 text-zinc-400 text-base">Chưa có dữ liệu bảo dưỡng nào cho xe này.</div>
            ) : (
              groupedTimeline.map((group) => {
                const isYearCollapsed = collapsedYears.includes(group.year);

                return (
                  <div key={group.year} className="mb-10 last:mb-0">
                    
                    {/* WATERMARK NĂM */}
                    <div className="relative flex items-center mb-6">
                      <div className="w-[96px] md:w-[112px] flex-shrink-0 text-right pr-2 md:pr-3"></div>
                      <div className="w-2 md:w-3 flex-shrink-0"></div>
                      
                      <div 
                        className="ml-5 md:ml-8 flex-1 flex items-center gap-3 cursor-pointer group"
                        onClick={() => toggleYear(group.year)}
                      >
                        <h2 className="text-4xl md:text-5xl font-black tracking-tight text-zinc-400 dark:text-zinc-600 group-hover:text-zinc-600 dark:group-hover:text-zinc-300 transition-colors">
                          {group.year}
                        </h2>
                        <ChevronDown 
                          size={28} 
                          className={`text-zinc-400 dark:text-zinc-600 group-hover:text-zinc-600 dark:group-hover:text-zinc-300 transition-transform duration-200 ${isYearCollapsed ? '-rotate-90' : ''}`} 
                        />
                      </div>
                    </div>

                    {!isYearCollapsed && (
                      <div className="space-y-8">
                        {group.items.map((item) => {
                          const isNearest = item.isFuture && item.isNearest;
                          const isExpanded = expandedCards.includes(item.id);
                          
                          let cardWrapperClass = "border rounded-2xl shadow-sm overflow-hidden flex flex-col ";
                          cardWrapperClass += isNearest 
                            ? "border-emerald-200 dark:border-emerald-900/50 bg-emerald-50/80 dark:bg-emerald-950/30" 
                            : "border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/60";

                          let iconBgClass = "bg-zinc-50 dark:bg-zinc-800 border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300";
                          if (isNearest) {
                            iconBgClass = "bg-emerald-100 dark:bg-emerald-900/50 border-emerald-200 dark:border-emerald-800 text-emerald-600 dark:text-emerald-400";
                          } else if (item.event_type === 'SỬA CHỮA') {
                            iconBgClass = "bg-amber-50 dark:bg-amber-950/30 border-amber-200/50 dark:border-amber-900/50 text-amber-500 dark:text-amber-400";
                          }

                          const formattedDate = new Date(item.due_date).toLocaleDateString('vi-VN');
                          const hasItems = item.maintenance_items && item.maintenance_items.length > 0;

                          return (
                            <div key={item.id} className="relative flex items-stretch">
                              
                              {/* CỘT TRÁI */}
                              <div className="w-[96px] md:w-[112px] flex-shrink-0 text-right pr-2 md:pr-3 flex flex-col items-end justify-center">
                                <span className={`inline-block text-xs md:text-sm font-mono py-1 rounded-md
                                  ${isNearest ? 'text-emerald-600 dark:text-emerald-500 font-bold' : 'text-zinc-600 dark:text-zinc-300 font-bold'}`}>
                                  {item.target_odo.toLocaleString('vi-VN')} km
                                </span>
                                <span className={`text-xs mt-1.5 tracking-widest ${isNearest ? 'text-emerald-600 dark:text-emerald-500 font-bold' : 'text-zinc-400 font-medium'}`}>
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
                              <div className="ml-5 md:ml-8 flex-1 py-1">
                                <div className={cardWrapperClass}>
                                  
                                  {/* KHỐI OVERVIEW */}
                                  <div 
                                    className={`flex flex-col ${hasItems ? 'cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors group/overview' : ''}`}
                                    onClick={() => hasItems && toggleCard(item.id)}
                                  >
                                    <div className="p-4 md:p-5 pb-2 flex gap-4 items-start">
                                      <div className={`mt-0.5 p-2 rounded-xl border flex-shrink-0 h-fit ${iconBgClass}`}>
                                        {item.event_type === 'SỬA CHỮA' ? <Wrench size={18} /> : <Settings size={18} />}
                                      </div>
                                      
                                      <div className="flex-1 pt-0.5 min-w-0">
                                        <div className="flex justify-between items-start gap-3 w-full">
                                          <div className="flex flex-col flex-1 min-w-0">
                                            <div className="flex items-center gap-2.5 flex-wrap">
                                              {isNearest && <div className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse"></div>}
                                              {/* Title sẽ bám sát toàn bộ chiều rộng do đã gỡ thẻ span cấp độ */}
                                              <p className="font-bold text-base md:text-lg text-zinc-900 dark:text-zinc-100 leading-tight">{item.title}</p>
                                            </div>
                                            
                                            {/* Location */}
                                            {item.location && (
                                              <div className="flex items-center gap-1.5 text-sm text-zinc-500 dark:text-zinc-400 mt-2">
                                                <MapPin size={16} className="flex-shrink-0" />
                                                <span className="truncate">{item.location}</span>
                                              </div>
                                            )}

                                            {/* Ghi Chú */}
                                            {item.notes && (
                                              <div className="mt-3 text-sm leading-relaxed text-zinc-700 dark:text-zinc-300 bg-zinc-100/50 dark:bg-zinc-800/30 px-3 py-2.5 rounded-lg border border-zinc-200/50 dark:border-zinc-700/50">
                                                <span className="font-semibold text-zinc-800 dark:text-zinc-200 mr-1.5">Ghi chú:</span>
                                                {item.notes}
                                              </div>
                                            )}
                                          </div>

                                          {item.isFuture ? (
                                            <span className="inline-block flex-shrink-0 mt-0.5 text-xs uppercase font-bold text-emerald-600 dark:text-emerald-500 bg-emerald-100/50 dark:bg-emerald-900/30 px-2 py-1 rounded">Sắp tới</span>
                                          ) : (
                                            <div className="flex items-center gap-1.5 flex-shrink-0 mt-0.5">
                                              <div className="bg-emerald-500 rounded-full p-1 flex items-center justify-center shadow-sm">
                                                <Check size={12} className="text-white" strokeWidth={4} />
                                              </div>
                                              <span className="text-xs md:text-sm font-medium text-emerald-600 dark:text-emerald-500">Hoàn thành</span>
                                            </div>
                                          )}
                                        </div>

                                        <div className="mt-3 w-full text-right">
                                          <p className="font-semibold text-zinc-900 dark:text-zinc-100 text-base md:text-lg whitespace-nowrap inline-block">
                                            {!item.isFuture && item.total_cost ? `${item.total_cost.toLocaleString('vi-VN')} đ` : null}
                                          </p>
                                        </div>

                                      </div>
                                    </div>

                                    {/* Mũi tên Dropdown CHỈ HIỆN nếu có danh sách vật tư bên trong */}
                                    {hasItems && (
                                      <div className="flex justify-center items-center pb-2 pt-1 text-zinc-300 dark:text-zinc-600 group-hover/overview:text-zinc-500 dark:group-hover/overview:text-zinc-400 transition-colors">
                                        <ChevronDown size={22} className={`transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`} />
                                      </div>
                                    )}
                                  </div>
                                  
                                  {/* KHỐI DETAIL (Danh sách hạng mục / vật tư) */}
                                  {isExpanded && hasItems && (
                                    <div className="px-4 md:px-5 pb-4 md:pb-5 border-t border-zinc-100 dark:border-zinc-800/60 bg-zinc-50/50 dark:bg-zinc-900/30">
                                      <div className="space-y-3 pt-4">
                                        {item.maintenance_items?.map((detail) => (
                                          <div key={detail.id} className="flex justify-between text-sm gap-3">
                                            <span className="text-zinc-600 dark:text-zinc-400 before:content-['•'] before:mr-2.5 before:text-zinc-300 flex-1">{detail.name}</span>
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
      <button className="fixed bottom-8 right-8 md:bottom-10 md:right-10 bg-zinc-900 hover:bg-zinc-800 active:bg-zinc-700 dark:bg-zinc-100 dark:hover:bg-zinc-200 dark:active:bg-zinc-300 text-white dark:text-zinc-900 shadow-xl rounded-full p-4 md:p-5 flex items-center justify-center z-50 transition-colors duration-150">
        <Plus size={28} />
      </button>

    </div>
  );
}
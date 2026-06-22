import { Navigate } from "react-router-dom";

/**
 * Пенообработка ПЗП объединена с разделом «Интенсификация добычи».
 * Все методы (пенные, кислотные, комбинированные) сведены в один модуль.
 * Эта страница перенаправляет на /stimulation с предвыбранным фильтром
 * по пенным методам.
 */
export default function FoamTreatment() {
  return <Navigate to="/stimulation?category=foam" replace />;
}

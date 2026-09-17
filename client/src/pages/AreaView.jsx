import { useParams } from "react-router-dom";
import RollupPage from "../components/RollupPage.jsx";

export default function AreaView() {
  const { id } = useParams();
  return <RollupPage level="store" areaId={id} />;
}

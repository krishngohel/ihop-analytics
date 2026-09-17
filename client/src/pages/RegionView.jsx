import { useParams } from "react-router-dom";
import RollupPage from "../components/RollupPage.jsx";

export default function RegionView() {
  const { id } = useParams();
  return <RollupPage level="area" regionId={id} />;
}

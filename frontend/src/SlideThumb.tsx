import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { DeckSlide } from "./api";

interface SlideThumbProps {
  slide: DeckSlide;
  index: number;
  isActive: boolean;
  onSelect: () => void;
  onDelete: () => void;
  canDelete: boolean;
}

export default function SlideThumb({ slide, index, isActive, onSelect, onDelete, canDelete }: SlideThumbProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: slide.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`slide-thumb ${isActive ? "slide-thumb-active" : ""}`}
      onClick={onSelect}
    >
      <span className="slide-thumb-drag" {...attributes} {...listeners} title="Drag to reorder">
        ::
      </span>
      <span className="slide-thumb-index">{index + 1}</span>
      <span className="slide-thumb-title">{slide.title}</span>
      {canDelete && (
        <button
          className="slide-thumb-delete"
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          title="Delete slide"
        >
          x
        </button>
      )}
    </div>
  );
}

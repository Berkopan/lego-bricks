import { colors } from "../engine/catalog";
import type { Language } from "../i18n";

export const manualLabels = {
  en: {
    title: "Building instructions",
    inventory: "Parts you will need",
    inventoryMore: "Parts list · continued",
    pieces: "pieces",
    variants: "part / color combinations",
    inventoryHint:
      "Gather the quantities shown in each color before you start.",
    continued: "The parts list continues on the next page.",
    plan: "Your build plan",
    assembly: "Assembly",
    step: "Step",
    steps: "steps",
    planHint:
      "Build the numbered assemblies in order. The final pages show their exact placement in your scene.",
    legendNew: "Add these pieces",
    legendOld: "Already built",
    legendDetail: "Check the close-up and top view for stud alignment.",
    reading: "Reading your manual",
    readingText:
      "Amber outlines mark the new pieces. The large view keeps the same angle and scale within an assembly. Close-ups show the connection without surrounding pieces hiding it.",
    coordinates: "Placement guide",
    coordinateText:
      "Positions are measured in stud pitches from the assembly origin. H is the center height above its base. 1 stud pitch = 8 mm; one plate is 0.4 pitch high. X points right and Z down in the top view.",
    caution: "Check before building",
    unsupported:
      "These pieces start above the base without a lower stud connection. Use the supporting surfaces shown in the scene, or hold them in position until the connecting pieces are added.",
    collision:
      "These pieces intersect in the captured scene. Their exact overlap cannot be reproduced with solid physical bricks.",
    "support-cycle":
      "This connection arrangement has no simple base-to-top order. Check the highlighted pieces before building.",
    "invalid-link":
      "A saved connection does not match the piece positions. Check these pieces before building.",
    "assembly-access":
      "Place the inner assembly at its final layout position first. Build the enclosing assembly around it; inserting the inner assembly afterward may be blocked.",
    overview: "Assembly overview",
    add: "ADD",
    detail: "CONNECTION DETAIL",
    top: "TOP VIEW",
    base: "Start with the base pieces.",
    attach:
      "Align the studs with the pieces already built, then press into place.",
    free: "Position this separate piece as shown in the final layout.",
    supportStep:
      "Hold this piece at the shown height until the joining pieces are added.",
    origin: "Origin",
    item: "Piece",
    position: "Position · X / H / Z",
    rotation: "Rotation · X / Y / Z",
    units: "Positions in stud pitches · rotations in degrees",
    final: "Your finished scene",
    finalHint:
      "Keep the original spacing and orientation. Use the numbered layout and placement table on the following pages.",
    placement: "Final placement",
    placementHint:
      "Assembly origins are shown in world coordinates. Place the completed assemblies at these positions and rotations.",
    worldTop: "SCENE FROM ABOVE",
    worldIso: "COMPLETED SCENE",
    custom: "Custom color",
    colorNames: ["Red", "Yellow", "Blue", "Green", "Ivory", "Charcoal"],
    independent: "Created in bricks. · Independent building guide",
    snapshot: "Scene captured",
    page: "Page",
    view: "View",
    notes: "Piece references",
  },
  tr: {
    title: "Yapım kılavuzu",
    inventory: "Gerekli parçalar",
    inventoryMore: "Parça listesi · devamı",
    pieces: "parça",
    variants: "parça / renk çeşidi",
    inventoryHint:
      "Başlamadan önce her renkten belirtilen sayıda parçayı hazırla.",
    continued: "Parça listesi sonraki sayfada devam ediyor.",
    plan: "Yapım planın",
    assembly: "Yapı",
    step: "Adım",
    steps: "adım",
    planHint:
      "Numaralı yapıları sırayla oluştur. Son sayfalar, bunları sahnendeki konumlarına yerleştirmene yardımcı olur.",
    legendNew: "Eklenecek parçalar",
    legendOld: "Önceden eklenenler",
    legendDetail: "Çıkıntıları hizalamak için yakın ve üst görünüşe bak.",
    reading: "Kılavuzu okuma",
    readingText:
      "Yeni parçalar turuncu çizgiyle vurgulanır. Büyük görünüşün açısı ve ölçeği yapı boyunca değişmez. Yakın görünüş, çevredeki parçaların arkasında kalan bağlantıyı gösterir.",
    coordinates: "Yerleşim rehberi",
    coordinateText:
      "Konumlar, yapının başlangıç noktasından çıkıntı aralığıyla ölçülür. H, parça merkezinin tabandan yüksekliğidir. Bir aralık 8 mm; plaka yüksekliği 0,4 aralıktır. Üst görünüşte X sağa, Z aşağı yönelir.",
    caution: "Yapmadan önce kontrol et",
    unsupported:
      "Bu parçalar tabanın üzerinde ve alttan bir çıkıntı bağlantısı yok. Sahnede gösterilen destek yüzeylerini kullan veya bağlayan parçalar eklenene kadar konumlarında tut.",
    collision:
      "Bu parçalar sahnede iç içe geçiyor. Katı fiziksel parçalarla aynı çakışma oluşturulamaz.",
    "support-cycle":
      "Bu bağlantılar tabandan yukarı basit bir sıraya izin vermiyor. İşaretli parçaları yapmadan önce kontrol et.",
    "invalid-link":
      "Kayıtlı bir bağlantı parça konumlarıyla uyuşmuyor. Bu parçaları kontrol et.",
    "assembly-access":
      "İçteki yapıyı önce son yerleşimdeki konumuna koy. Onu çevreleyen yapıyı etrafında oluştur; sonradan içeri yerleştirmek mümkün olmayabilir.",
    overview: "Yapının görünüşü",
    add: "EKLE",
    detail: "BAĞLANTI DETAYI",
    top: "ÜST GÖRÜNÜŞ",
    base: "Taban parçalarıyla başla.",
    attach: "Çıkıntıları önceki parçalarla hizala ve yerine bastır.",
    free: "Bu ayrı parçayı son yerleşim sayfasındaki gibi konumlandır.",
    supportStep:
      "Bağlayan parçalar eklenene kadar bu parçayı gösterilen yükseklikte tut.",
    origin: "Başlangıç",
    item: "Parça",
    position: "Konum · X / H / Z",
    rotation: "Dönüş · X / Y / Z",
    units: "Konumlar çıkıntı aralığı · dönüşler derece",
    final: "Tamamlanmış sahnen",
    finalHint:
      "Asıl aralıkları ve yönleri koru. Sonraki sayfalardaki numaralı yerleşim görünüşünü ve konum tablosunu kullan.",
    placement: "Son yerleşim",
    placementHint:
      "Başlangıç noktaları dünya koordinatlarıyla verilmiştir. Tamamladığın yapıları bu konum ve dönüşlere yerleştir.",
    worldTop: "SAHNEYE ÜSTTEN BAKIŞ",
    worldIso: "TAMAMLANMIŞ SAHNE",
    custom: "Özel renk",
    colorNames: ["Kırmızı", "Sarı", "Mavi", "Yeşil", "Krem", "Antrasit"],
    independent: "bricks. ile oluşturuldu · Bağımsız yapım kılavuzu",
    snapshot: "Sahne kaydı",
    page: "Sayfa",
    view: "Görünüş",
    notes: "Parça numaraları",
  },
};

export function manualColorName(color: string, language: Language) {
  const index = colors.indexOf(color.toLowerCase());
  return index < 0
    ? manualLabels[language].custom
    : manualLabels[language].colorNames[index];
}

module.exports = {
    /**
     * @param {string} sn
     * @param {any} data
     * @param {string} objChannel
     * @param {string} objName
     * @param {any} lang
     */
    async addDeleteObject(sn, data, objChannel, objName, lang) {
        if (!Array.isArray(data)) {
            return;
        }
        const objs = await this.iob.getChannelsAsync();
        const obj = objs.filter(m => m._id.includes(`${this.iob.namespace}.${sn}.map.${objChannel}.0`));
        const zone = Object.keys(data).length;
        const zones = Object.keys(obj).length;
        for (let a = 1; a <= zone; a++) {
            const counter = `0${a}`.slice(-2);
            const path = `${sn}.map.${objChannel}.${counter}`;
            //await this.iob.extendObject(`${path}.name`, { common: { write: true } });
            await this.iob
                .setObjectNotExistsAsync(`${this.iob.namespace}.${path}.delete_${objName}`, {
                    type: "state",
                    common: {
                        name: lang,
                        type: "boolean",
                        role: "button",
                        write: true,
                        read: false,
                        def: false,
                    },
                    native: {},
                })
                .catch(error => {
                    this.log.error(`delete ${objName}: ${error.name}: ${error.message}`);
                });
        }
        if (zones > zone) {
            let count = zones;
            let save = 0;
            for (let a = zone; a <= zones - 1; a++) {
                const counter = `0${count}`.slice(-2);
                this.log.info(`delete ${objName}: ${this.iob.namespace}.${sn}.map.${objChannel}.${counter}`);
                await this.iob.delObjectAsync(`${this.iob.namespace}.${sn}.map.${objChannel}.${counter}`, {
                    recursive: true,
                });
                --count;
                ++save;
                if (save > 10) {
                    break;
                }
            }
        }
        // ToDo Change object name
    },
    /**
     * @param {string} sn
     */
    async createLivemapSettings(sn) {
        let common;
        common = {
            name: {
                en: "Livemap settings",
                de: "Livemap-Einstellungen",
                ru: "Настройки интерактивной карты",
                pt: "Configurações do mapa ao vivo",
                nl: "Livemap-instellingen",
                fr: "Paramètres de la carte en direct",
                it: "Impostazioni di Livemap",
                es: "Configuración de Livemap",
                pl: "Ustawienia mapy na żywo",
                uk: "Налаштування живої карти",
                "zh-cn": "实时地图设置",
            },
            desc: "Create by Adapter",
            icon: "img/map.png",
        };
        await this.createDataPoint(`${this.iob.namespace}.${sn}.map.map_settings`, common, "channel", null, null, null);
        common = {
            type: "string",
            role: "state",
            name: {
                en: "Region channel = fill",
                de: "Regionskanal = füllen",
                ru: "Региональный канал = заполнить",
                pt: "Canal da região = preencher",
                nl: "Regio-kanaal = vullen",
                fr: "Canal de région = remplissage",
                it: "Canale della regione = riempire",
                es: "Canal de región = rellenar",
                pl: "Kanał regionu = wypełnienie",
                uk: "Канал регіону = заповнення",
                "zh-cn": "区域通道 = 填充",
            },
            desc: "Create by Adapter",
            read: true,
            write: true,
            def: "rgba(128,128,128,0.35)",
        };
        await this.createDataPoint(
            `${this.iob.namespace}.${sn}.map.map_settings.region_channel_fill`,
            common,
            "state",
            null,
            null,
            null,
        );
        common = {
            type: "string",
            role: "state",
            name: {
                en: "Region channel = stroke",
                de: "Regionskanal = Strich",
                ru: "Региональный канал = инсульт",
                pt: "Canal da região = traço",
                nl: "Regio-kanaal = slag",
                fr: "Canal de région = trait",
                it: "Canale della regione = tratto",
                es: "Canal de región = trazo",
                pl: "Kanał regionu = udar",
                uk: "Канал регіону = обведення",
                "zh-cn": "区域通道 = 笔画",
            },
            desc: "Create by Adapter",
            read: true,
            write: true,
            def: "rgba(128,128,128,1)",
        };
        await this.createDataPoint(
            `${this.iob.namespace}.${sn}.map.map_settings.region_channel_stroke`,
            common,
            "state",
            null,
            null,
            null,
        );
        common = {
            type: "number",
            role: "level",
            name: {
                en: "Region channel = lineWidth",
                de: "Regionskanal = Linienbreite",
                ru: "Region channel = lineWidth",
                pt: "Canal da região = largura da linha",
                nl: "Regiokanaal = lijnbreedte",
                fr: "Canal de région = largeur de ligne",
                it: "Canale della regione = larghezza della linea",
                es: "Canal de región = ancho de línea",
                pl: "Kanał regionu = szerokość linii",
                uk: "Канал регіону = ширина лінії",
                "zh-cn": "区域通道 = 线宽",
            },
            desc: "Create by Adapter",
            read: true,
            write: true,
            unit: "px",
            def: 1,
        };
        await this.createDataPoint(
            `${this.iob.namespace}.${sn}.map.map_settings.region_channel_lineWidth`,
            common,
            "state",
            null,
            null,
            null,
        );
        common = {
            type: "string",
            role: "state",
            name: {
                en: "Region work = fill",
                de: "Regionsarbeit = füllen",
                ru: "Региональная работа = заполнение",
                pt: "Trabalho regional = preenchimento",
                nl: "Regio werk = invullen",
                fr: "Travail régional = remplissage",
                it: "Lavoro nella regione = riempire",
                es: "Trabajo de región = rellenar",
                pl: "Praca w regionie = wypełnienie",
                uk: "Регіональна робота = заповнення",
                "zh-cn": "区域工作 = 填充",
            },
            desc: "Create by Adapter",
            read: true,
            write: true,
            def: "rgba(34,139,34,1)",
        };
        await this.createDataPoint(
            `${this.iob.namespace}.${sn}.map.map_settings.region_work_fill`,
            common,
            "state",
            null,
            null,
            null,
        );
        common = {
            type: "string",
            role: "state",
            name: {
                en: "Region work = stroke",
                de: "Regionsarbeit = Strich",
                ru: "Региональная работа = инсульт",
                pt: "Trabalho regional = derrame",
                nl: "Regio-werk = slag",
                fr: "Travail régional = trait",
                it: "lavoro regionale = colpo",
                es: "Trabajo regional = accidente cerebrovascular",
                pl: "Praca nad regionem = udar",
                uk: "Регіональна робота = інсульт",
                "zh-cn": "区域工作 = 笔画",
            },
            desc: "Create by Adapter",
            read: true,
            write: true,
            def: "rgba(0,0,0,1)",
        };
        await this.createDataPoint(
            `${this.iob.namespace}.${sn}.map.map_settings.region_work_stroke`,
            common,
            "state",
            null,
            null,
            null,
        );
        common = {
            type: "number",
            role: "level",
            name: {
                en: "Region work = line width",
                de: "Bereichsarbeit = Linienbreite",
                ru: "Региональная работа = ширина линии",
                pt: "Trabalho regional = largura da linha",
                nl: "Werking van het gebied = lijnbreedte",
                fr: "Travail de la région = largeur de ligne",
                it: "Area di lavoro = larghezza della linea",
                es: "Trabajo de la región = ancho de línea",
                pl: "Praca w regionie = szerokość linii",
                uk: "Робота з регіоном = ширина лінії",
                "zh-cn": "区域工作 = 线宽",
            },
            desc: "Create by Adapter",
            read: true,
            write: true,
            unit: "px",
            def: 1,
        };
        await this.createDataPoint(
            `${this.iob.namespace}.${sn}.map.map_settings.region_work_lineWidth`,
            common,
            "state",
            null,
            null,
            null,
        );
        common = {
            type: "string",
            role: "state",
            name: {
                en: "Region forbidden = fill",
                de: "Verbotener Bereich = ausfüllen",
                ru: "Запрещённая область = заливка",
                pt: "Área proibida = preencher",
                nl: "Verboden gebied = opvullen",
                fr: "Zone interdite = remplissage",
                it: "Regione vietata = riempire",
                es: "Área prohibida = rellenar",
                pl: "Region zabroniony = wypełnienie",
                uk: "Заборонена область = заповнення",
                "zh-cn": "Region forbidden = fill",
            },
            desc: "Create by Adapter",
            read: true,
            write: true,
            def: "rgba(240,128,128,0.78)",
        };
        await this.createDataPoint(
            `${this.iob.namespace}.${sn}.map.map_settings.region_forbidden_fill`,
            common,
            "state",
            null,
            null,
            null,
        );
        common = {
            type: "string",
            role: "state",
            name: {
                en: "Region forbidden = stroke",
                de: "Verbotener Bereich = Strich",
                ru: "Запрещенный регион = штрих",
                pt: "Região proibida = traço",
                nl: "Verboden gebied = streep",
                fr: "Région interdite = trait",
                it: "Regione vietata = tratto",
                es: "Región prohibida = trazo",
                pl: "Region zabroniony = pociągnięcie",
                uk: "Заборонена область = штрих",
                "zh-cn": "Region forbidden = stroke",
            },
            desc: "Create by Adapter",
            read: true,
            write: true,
            def: "rgba(255,0,0,1)",
        };
        await this.createDataPoint(
            `${this.iob.namespace}.${sn}.map.map_settings.region_forbidden_stroke`,
            common,
            "state",
            null,
            null,
            null,
        );
        common = {
            type: "number",
            role: "level",
            name: {
                en: "Region forbidden = line width",
                de: "Verbotener Bereich = Linienbreite",
                ru: "Запрещённая область = ширина линии",
                pt: "Região proibida = largura da linha",
                nl: "Verboden gebied = lijnbreedte",
                fr: "Zone interdite = largeur de trait",
                it: "Regione vietata = spessore della linea",
                es: "Región prohibida = ancho de línea",
                pl: "Zakazany obszar = szerokość linii",
                uk: "Заборонена область = ширина лінії",
                "zh-cn": "Region forbidden = line width",
            },
            desc: "Create by Adapter",
            read: true,
            write: true,
            unit: "px",
            def: 1,
        };
        await this.createDataPoint(
            `${this.iob.namespace}.${sn}.map.map_settings.region_forbidden_lineWidth`,
            common,
            "state",
            null,
            null,
            null,
        );
        common = {
            type: "string",
            role: "state",
            name: {
                en: "Region placed blank = fill",
                de: "Leer gelassenes Feld = ausfüllen",
                ru: "Если поле «Регион» осталось пустым, то заполнить",
                pt: "Região deixada em branco = preencher",
                nl: "Regio leeg gelaten = opvullen",
                fr: "Zone laissée vide = remplir",
                it: "Regione lasciata vuota = riempire",
                es: "Si la región está en blanco = rellenar",
                pl: "Pole „Region” pozostawiono puste = wypełnij",
                uk: "Якщо поле «Регіон» залишено порожнім, то заповнити",
                "zh-cn": "Region placed blank = fill",
            },
            desc: "Create by Adapter",
            read: true,
            write: true,
            def: "rgba(0,0,255,0.59)",
        };
        await this.createDataPoint(
            `${this.iob.namespace}.${sn}.map.map_settings.region_placed_blank_fill`,
            common,
            "state",
            null,
            null,
            null,
        );
        common = {
            type: "string",
            role: "state",
            name: {
                en: "Region placed blank = stroke",
                de: "Leer gelassenes Feld = Strich",
                ru: "Если поле «Регион» оставлено пустым, используется контур",
                pt: "Região deixada em branco = traço",
                nl: "Regio leeg gelaten = lijn",
                fr: "Région laissée vide = trait",
                it: "Se la regione è vuota = tratto",
                es: "Región sin rellenar = trazo",
                pl: "Puste pole regionu = obrys",
                uk: "Якщо для регіону вказано порожнє значення = обведення",
                "zh-cn": "Region placed blank = stroke",
            },
            desc: "Create by Adapter",
            read: true,
            write: true,
            def: "rgba(0,0,255,1)",
        };
        await this.createDataPoint(
            `${this.iob.namespace}.${sn}.map.map_settings.region_placed_blank_stroke`,
            common,
            "state",
            null,
            null,
            null,
        );
        common = {
            type: "number",
            role: "level",
            name: {
                en: "Region placed blank = line width",
                de: "Leer gelassenes Feld „Region“ = Linienbreite",
                ru: "Если поле «Регион» оставлено пустым, то ширина линии равна",
                pt: "Região deixada em branco = largura da linha",
                nl: "Regio ingesteld op blanco = lijnbreedte",
                fr: "Zone laissée vide = largeur de ligne",
                it: 'Se il campo "Regione" è vuoto = larghezza della linea',
                es: "Región sin rellenar = ancho de línea",
                pl: "Pole regionu pozostawione puste = szerokość linii",
                uk: "Якщо для регіону вказано «порожнє» = ширина лінії",
                "zh-cn": "Region placed blank = line width",
            },
            desc: "Create by Adapter",
            read: true,
            write: true,
            unit: "px",
            def: 1,
        };
        await this.createDataPoint(
            `${this.iob.namespace}.${sn}.map.map_settings.region_placed_blank_lineWidth`,
            common,
            "state",
            null,
            null,
            null,
        );
        common = {
            type: "string",
            role: "state",
            name: {
                en: "Region obstacle = fill",
                de: "Hindernis in der Region = ausfüllen",
                ru: "Регион препятствия = заливка",
                pt: "Obstáculo da região = preenchimento",
                nl: "Regio-obstakel = opvullen",
                fr: "Obstacle de région = remplissage",
                it: "Ostacolo della regione = riempire",
                es: "Obstáculo de la región = relleno",
                pl: "Przeszkoda w regionie = wypełnienie",
                uk: "Перешкода регіону = заповнення",
                "zh-cn": "Region obstacle = fill",
            },
            desc: "Create by Adapter",
            read: true,
            write: true,
            def: "rgba(128,128,128,0.78)",
        };
        await this.createDataPoint(
            `${this.iob.namespace}.${sn}.map.map_settings.region_obstacle_fill`,
            common,
            "state",
            null,
            null,
            null,
        );
        common = {
            type: "string",
            role: "state",
            name: {
                en: "Region obstacle = stroke",
                de: "Region Hindernis = Strich",
                ru: "Препятствие региона = удар",
                pt: "Obstáculo regional = curso",
                nl: "Gebiedsobstakel = slag",
                fr: "Obstacle régional = course",
                it: "Ostacolo della regione = ictus",
                es: "Obstáculo de la región = accidente cerebrovascular",
                pl: "Przeszkoda w regionie = udar",
                uk: "Область перешкод = інсульт",
                "zh-cn": "区域障碍=中风",
            },
            desc: "Create by Adapter",
            read: true,
            write: true,
            def: "rgba(169,169,169,1)",
        };
        await this.createDataPoint(
            `${this.iob.namespace}.${sn}.map.map_settings.region_obstacle_stroke`,
            common,
            "state",
            null,
            null,
            null,
        );
        common = {
            type: "number",
            role: "level",
            name: {
                en: "Region obstacle = line width",
                de: "Hindernis in der Region = Linienbreite",
                ru: "Препятствие в регионе = ширина линии",
                pt: "Obstáculo da região = largura da linha",
                nl: "Regio-obstakel = lijnbreedte",
                fr: "Obstacle de région = largeur de ligne",
                it: "Ostacolo della regione = larghezza della linea",
                es: "Obstáculo de la región = ancho de la línea",
                pl: "Przeszkoda regionalna = szerokość linii",
                uk: "Перешкода регіону = ширина лінії",
                "zh-cn": "Region obstacle = line width",
            },
            desc: "Create by Adapter",
            read: true,
            write: true,
            unit: "px",
            def: 1,
        };
        await this.createDataPoint(
            `${this.iob.namespace}.${sn}.map.map_settings.region_obstacle_lineWidth`,
            common,
            "state",
            null,
            null,
            null,
        );
        common = {
            type: "string",
            role: "state",
            name: {
                en: "Region obstacle = stroke",
                de: "Region Hindernis = Strich",
                ru: "Препятствие региона = удар",
                pt: "Obstáculo regional = curso",
                nl: "Gebiedsobstakel = slag",
                fr: "Obstacle régional = course",
                it: "Ostacolo della regione = ictus",
                es: "Obstáculo de la región = accidente cerebrovascular",
                pl: "Przeszkoda w regionie = udar",
                uk: "Область перешкод = інсульт",
                "zh-cn": "区域障碍=中风",
            },
            desc: "Create by Adapter",
            read: true,
            write: true,
            def: "rgba(0,0,0,1)",
        };
        await this.createDataPoint(
            `${this.iob.namespace}.${sn}.map.map_settings.divide_area_work_stroke`,
            common,
            "state",
            null,
            null,
            null,
        );
        common = {
            type: "number",
            role: "level",
            name: {
                en: "Region obstacle = line width",
                de: "Hindernis in der Region = Linienbreite",
                ru: "Препятствие в регионе = ширина линии",
                pt: "Obstáculo da região = largura da linha",
                nl: "Regio-obstakel = lijnbreedte",
                fr: "Obstacle de région = largeur de ligne",
                it: "Ostacolo della regione = larghezza della linea",
                es: "Obstáculo de la región = ancho de la línea",
                pl: "Przeszkoda regionalna = szerokość linii",
                uk: "Перешкода регіону = ширина лінії",
                "zh-cn": "Region obstacle = line width",
            },
            desc: "Create by Adapter",
            read: true,
            write: true,
            unit: "px",
            def: 2,
        };
        await this.createDataPoint(
            `${this.iob.namespace}.${sn}.map.map_settings.divide_area_work_lineWidth`,
            common,
            "state",
            null,
            null,
            null,
        );
        common = {
            type: "string",
            role: "state",
            name: {
                en: "Mowing history color",
                de: "Farbe des Mähverlaufs",
                ru: "Цвет истории кошения",
                pt: "Cor do histórico de corte",
                nl: "Kleur van de maaihistorie",
                fr: "Historique des tontes (en couleur)",
                it: "Cromatura della cronologia di falciatura",
                es: "Color del historial de siega",
                pl: "Kolor historii koszenia",
                uk: "Колір історії косіння",
                "zh-cn": "Mowing history color",
            },
            desc: "Create by Adapter",
            read: true,
            write: true,
            def: "rgba(124,252,0,1)",
        };
        await this.createDataPoint(
            `${this.iob.namespace}.${sn}.map.map_settings.polyline_color`,
            common,
            "state",
            null,
            null,
            null,
        );
        common = {
            type: "number",
            role: "level",
            name: {
                en: "Mowing history line widht",
                de: "Breite der Mähspur",
                ru: "Ширина полосы кошения",
                pt: "Largura da linha de corte",
                nl: "Breedte van de maaibaan",
                fr: "Largeur de la ligne d'historique de tonte",
                it: "Larghezza della linea di taglio",
                es: "Ancho de la línea de corte",
                pl: "Szerokość linii historii koszenia",
                uk: "Ширина смуги косіння",
                "zh-cn": "Mowing history line widht",
            },
            desc: "Create by Adapter",
            read: true,
            write: true,
            unit: "px",
            def: 1,
        };
        await this.createDataPoint(
            `${this.iob.namespace}.${sn}.map.map_settings.polyline_lineWidth`,
            common,
            "state",
            null,
            null,
            null,
        );
        common = {
            type: "number",
            role: "level",
            name: {
                en: "Scaling of robot and charger",
                de: "Dimensionierung von Roboter und Ladegerät",
                ru: "Масштабирование робота и зарядного устройства",
                pt: "Dimensionamento do robô e do carregador",
                nl: "Afmetingen van de robot en de oplader",
                fr: "Dimensionnement du robot et du chargeur",
                it: "Dimensioni del robot e del caricatore",
                es: "Dimensionamiento del robot y del cargador",
                pl: "Dopasowanie rozmiarów robota i ładowarki",
                uk: "Масштабування робота та зарядного пристрою",
                "zh-cn": "Scaling of robot and charger",
            },
            desc: "Create by Adapter",
            read: true,
            write: true,
            def: 2,
        };
        await this.createDataPoint(
            `${this.iob.namespace}.${sn}.map.map_settings.robot_charger_scale`,
            common,
            "state",
            null,
            null,
            null,
        );
        common = {
            type: "string",
            role: "state",
            name: {
                en: "Path to robot image",
                de: "Pfad zum Roboterbild",
                ru: "Путь к изображению робота",
                pt: "Caminho para a imagem do robô",
                nl: "Pad naar de afbeelding van de robot",
                fr: "Chemin d'accès à l'image du robot",
                it: "Percorso dell'immagine del robot",
                es: "Ruta de acceso a la imagen del robot",
                pl: "Ścieżka do obrazu robota",
                uk: "Шлях до зображення робота",
                "zh-cn": "Path to robot image",
            },
            desc: "Create by Adapter",
            read: true,
            write: true,
            def: "img/robot.png",
        };
        await this.createDataPoint(
            `${this.iob.namespace}.${sn}.map.map_settings.robot_path`,
            common,
            "state",
            null,
            null,
            null,
        );
        common = {
            type: "number",
            role: "level",
            name: {
                en: "Scaling of chargers",
                de: "Skalierung von Ladegeräten",
                ru: "Масштабирование зарядных устройств",
                pt: "Dimensionamento dos carregadores",
                nl: "Schaalbaarheid van opladers",
                fr: "Dimensionnement des chargeurs",
                it: "Adattamento delle dimensioni dei caricabatterie",
                es: "Dimensionamiento de los cargadores",
                pl: "Skalowanie ładowarek",
                uk: "Масштабування зарядних пристроїв",
                "zh-cn": "Scaling of chargers",
            },
            desc: "Create by Adapter",
            read: true,
            write: true,
            def: 2,
        };
        await this.createDataPoint(
            `${this.iob.namespace}.${sn}.map.map_settings.charger_scale`,
            common,
            "state",
            null,
            null,
            null,
        );
        common = {
            type: "string",
            role: "state",
            name: {
                en: "Path to charger image",
                de: "Pfad zum Bild des Ladegeräts",
                ru: "Путь к изображению зарядного устройства",
                pt: "Caminho para a imagem do carregador",
                nl: "Afbeelding van het pad naar de oplader",
                fr: "Chemin d'accès à l'image du chargeur",
                it: "Percorso dell'immagine del caricabatterie",
                es: "Ruta a la imagen del cargador",
                pl: "Ścieżka do obrazka przedstawiającego ładowarkę",
                uk: "Шлях до зображення зарядного пристрою",
                "zh-cn": "Path to charger image",
            },
            desc: "Create by Adapter",
            read: true,
            write: true,
            def: "img/charger.png",
        };
        await this.createDataPoint(
            `${this.iob.namespace}.${sn}.map.map_settings.charger_path`,
            common,
            "state",
            null,
            null,
            null,
        );
    },
    /**
     * @param {string} sn
     * @param {any} data
     * @param {string} path
     */
    async setCustomMultiAngle(sn, data, path) {
        if (data.work_gap != null) {
            await this.iob.setState(`${this.iob.namespace}.${path}.work_gap`, { val: data.work_gap, ack: true });
        }
        if (data.plan_mode != null) {
            await this.iob.setState(`${this.iob.namespace}.${path}.plan_mode`, { val: data.plan_mode, ack: true });
        }
        if (data.region_id != null) {
            const region = typeof data.region_id === "number" ? data.region_id : Number(data.region_id);
            await this.iob.setState(`${this.iob.namespace}.${path}.region_id`, { val: region, ack: true });
        }
        if (data.start != null) {
            await this.iob.setState(`${this.iob.namespace}.${path}.start`, { val: data.start, ack: true });
        }
        if (data.work_speed != null) {
            await this.iob.setState(`${this.iob.namespace}.${path}.work_speed`, { val: data.work_speed, ack: true });
        }
        if (data.setting != null) {
            const setting = data.setting ? 1 : 0;
            await this.iob.setState(`${this.iob.namespace}.${path}.setting`, { val: setting, ack: true });
        }
        if (data != null) {
            await this.iob.setState(`${this.iob.namespace}.${path}.currentCustomRaw`, {
                val: JSON.stringify(data),
                ack: true,
            });
        }
    },
    /**
     * @param {string} sn
     * @param {string} path
     */
    async createCustomMultiAngle(sn, path) {
        await this.iob
            .setObjectNotExistsAsync(`${this.iob.namespace}.${path}`, {
                type: "channel",
                common: {
                    name: {
                        en: "Custom Multi-Angle",
                        de: "Benutzerdefinierter Mehrwinkel",
                        ru: "Пользовательский многоугольный",
                        pt: "Multiângulo personalizado",
                        nl: "Aangepaste multi-hoek",
                        fr: "Multi-angles personnalisé",
                        it: "Multi-angolo personalizzato",
                        es: "Ángulo múltiple personalizado",
                        pl: "Niestandardowy wielokątowy",
                        uk: "Користувацька багатокутна",
                        "zh-cn": "定制多角度",
                    },
                },
                native: {},
            })
            .catch(error => {
                this.log.error(`Custom-Multi-Angle: ${error.name}: ${error.message}`);
            });
        await this.iob
            .setObjectNotExistsAsync(`${this.iob.namespace}.${path}.multi_angle`, {
                type: "channel",
                common: {
                    name: {
                        en: "Multi-angle",
                        de: "Multi-Winkel",
                        ru: "Многоугольный",
                        pt: "Multiângulo",
                        nl: "Meerdere hoeken",
                        fr: "Multi-angle",
                        it: "Multiangolo",
                        es: "Ángulo múltiple",
                        pl: "Wielokątowy",
                        uk: "Багатокутний",
                        "zh-cn": "多角度",
                    },
                },
                native: {},
            })
            .catch(error => {
                this.log.error(`Custom-Multi-Angle: ${error.name}: ${error.message}`);
            });
        await this.iob
            .setObjectNotExistsAsync(`${this.iob.namespace}.${path}.work_gap`, {
                type: "state",
                common: {
                    name: {
                        en: "Cutting Spacing",
                        de: "Schneiden Abstand",
                        ru: "Расстояние между режущими инструментами",
                        pt: "Espaçamento de corte",
                        nl: "Snijafstand",
                        fr: "Espacement de coupe",
                        it: "Spazio di taglio",
                        es: "Espaciado de corte",
                        pl: "Odstępy między cięciami",
                        uk: "Інтервал різання",
                        "zh-cn": "切割间距",
                    },
                    type: "number",
                    role: "level",
                    write: true,
                    read: true,
                    def: 2,
                    states: {
                        1: "narrow",
                        2: "standard",
                        3: "wide",
                    },
                },
                native: {},
            })
            .catch(error => {
                this.log.error(`Custom-Multi-Angle: ${error.name}: ${error.message}`);
            });
        await this.iob
            .setObjectNotExistsAsync(`${this.iob.namespace}.${path}.region_id`, {
                type: "state",
                common: {
                    name: {
                        en: "Region-Id",
                        de: "Region-ID",
                        ru: "Идентификатор региона",
                        pt: "ID da região",
                        nl: "Regio-ID",
                        fr: "Identifiant de région",
                        it: "ID regione",
                        es: "Identificador de región",
                        pl: "Identyfikator regionu",
                        uk: "Ідентифікатор регіону",
                        "zh-cn": "区域 ID",
                    },
                    type: "number",
                    role: "value",
                    write: false,
                    read: true,
                    def: 0,
                },
                native: {},
            })
            .catch(error => {
                this.log.error(`Custom-Multi-Angle: ${error.name}: ${error.message}`);
            });
        await this.iob
            .setObjectNotExistsAsync(`${this.iob.namespace}.${path}.start`, {
                type: "state",
                common: {
                    name: {
                        en: "Use immediately",
                        de: "Sofort verwenden",
                        ru: "Использовать немедленно",
                        pt: "Usar imediatamente",
                        nl: "Direct gebruiken",
                        fr: "Utiliser immédiatement",
                        it: "Da utilizzare immediatamente",
                        es: "Utilizar inmediatamente",
                        pl: "Spożyć natychmiast",
                        uk: "Використати негайно",
                        "zh-cn": "立即使用",
                    },
                    type: "number",
                    role: "level",
                    write: true,
                    read: true,
                    min: 0,
                    max: 1,
                    def: 0,
                    states: {
                        0: "Use for next mow",
                        1: "Use immediately",
                    },
                },
                native: {},
            })
            .catch(error => {
                this.log.error(`Custom-Multi-Angle: ${error.name}: ${error.message}`);
            });
        await this.iob
            .setObjectNotExistsAsync(`${this.iob.namespace}.${path}.setting`, {
                type: "state",
                common: {
                    name: {
                        en: "Use standard Multi-Angle",
                        de: "Standard-Mehrwinkelkamera verwenden",
                        ru: "Используйте стандартный многоугольный режим",
                        pt: "Use o padrão Multi-Ângulo",
                        nl: "Gebruik de standaard Multi-Angle.",
                        fr: "Utiliser un multi-angle standard",
                        it: "Utilizzare lo standard Multi-Angle",
                        es: "Utilice el estándar Multi-Angle",
                        pl: "Użyj standardowego Multi-Angle",
                        uk: "Використовуйте стандартний багатокутний",
                        "zh-cn": "使用标准多角度",
                    },
                    type: "number",
                    role: "level",
                    write: true,
                    read: true,
                    min: 0,
                    max: 1,
                    def: 0,
                    states: {
                        0: "Use default settings",
                        1: "Use custom settings",
                    },
                },
                native: {},
            })
            .catch(error => {
                this.log.error(`Custom-Multi-Angle: ${error.name}: ${error.message}`);
            });
        await this.iob
            .setObjectNotExistsAsync(`${this.iob.namespace}.${path}.work_speed`, {
                type: "state",
                common: {
                    name: {
                        en: "Mowing Speed",
                        de: "Mähgeschwindigkeit",
                        ru: "Скорость кошения",
                        pt: "Velocidade de corte",
                        nl: "Maaisnelheid",
                        fr: "Vitesse de tonte",
                        it: "Velocità di taglio",
                        es: "Velocidad de corte",
                        pl: "Prędkość koszenia",
                        uk: "Швидкість скошування",
                        "zh-cn": "割草速度",
                    },
                    type: "number",
                    role: "level",
                    write: true,
                    read: true,
                    def: 2,
                    states: {
                        1: "slow",
                        2: "standard",
                        3: "fast",
                    },
                },
                native: {},
            })
            .catch(error => {
                this.log.error(`Custom-Multi-Angle: ${error.name}: ${error.message}`);
            });
        await this.iob
            .setObjectNotExistsAsync(`${this.iob.namespace}.${path}.setCustomZoneSettings`, {
                type: "state",
                common: {
                    name: {
                        en: "Apply settings",
                        de: "Einstellungen anwenden",
                        ru: "Применить настройки",
                        pt: "Aplicar configurações",
                        nl: "Instellingen toepassen",
                        fr: "Appliquer les paramètres",
                        it: "Applica le impostazioni",
                        es: "Aplicar configuración",
                        pl: "Zastosuj ustawienia",
                        uk: "Застосувати налаштування",
                        "zh-cn": "应用设置",
                    },
                    type: "boolean",
                    role: "button",
                    write: true,
                    read: false,
                    def: false,
                },
                native: {},
            })
            .catch(error => {
                this.log.error(`Custom-Multi-Angle: ${error.name}: ${error.message}`);
            });
        await this.iob
            .setObjectNotExistsAsync(`${this.iob.namespace}.${path}.setCustomRaw`, {
                type: "state",
                common: {
                    name: {
                        en: "Apply custom raw",
                        de: "Benutzerdefinierten Rohdaten anwenden",
                        ru: "Применить пользовательские исходные данные",
                        pt: "Aplicar matéria-prima personalizada",
                        nl: "Aangepaste ruwe gegevens toepassen",
                        fr: "Appliquer des matières premières personnalisées",
                        it: "Applica il raw personalizzato",
                        es: "Aplicar materia prima personalizada",
                        pl: "Zastosuj niestandardowy surowiec",
                        uk: "Застосувати користувацький RAW",
                        "zh-cn": "应用自定义原始数据",
                    },
                    type: "string",
                    role: "json",
                    write: true,
                    read: true,
                    def: "",
                },
                native: {},
            })
            .catch(error => {
                this.log.error(`Custom-Multi-Angle: ${error.name}: ${error.message}`);
            });
        await this.iob
            .setObjectNotExistsAsync(`${this.iob.namespace}.${path}.currentCustomRaw`, {
                type: "state",
                common: {
                    name: {
                        en: "Current custom setting",
                        de: "Aktuelle benutzerdefinierte Einstellung",
                        ru: "Текущие пользовательские настройки",
                        pt: "Configuração personalizada atual",
                        nl: "Huidige aangepaste instelling",
                        fr: "Paramètres personnalisés actuels",
                        it: "Impostazione personalizzata corrente",
                        es: "Configuración personalizada actual",
                        pl: "Aktualne ustawienie niestandardowe",
                        uk: "Поточне налаштування користувача",
                        "zh-cn": "当前自定义设置",
                    },
                    type: "string",
                    role: "json",
                    write: false,
                    read: true,
                    def: JSON.stringify({}),
                },
                native: {},
            })
            .catch(error => {
                this.log.error(`Custom-Multi-Angle: ${error.name}: ${error.message}`);
            });
        await this.iob
            .setObjectNotExistsAsync(`${this.iob.namespace}.${sn}.map.zones.settings_all_zones`, {
                type: "state",
                common: {
                    name: {
                        en: "False: Standard setting True: Custom setting",
                        de: "Falsch: Standardeinstellung. Wahr: Benutzerdefinierte Einstellung.",
                        ru: "Ложь: Стандартная настройка Истина: Пользовательская настройка",
                        pt: "Falso: Configuração padrão. Verdadeiro: Configuração personalizada.",
                        nl: "Onwaar: Standaardinstelling Waar: Aangepaste instelling",
                        fr: "Faux : Paramètre standard Vrai : Paramètre personnalisé",
                        it: "Falso: impostazione standard Vero: impostazione personalizzata",
                        es: "Falso: Configuración estándar Verdadero: Configuración personalizada",
                        pl: "Fałsz: Ustawienie standardowe Prawda: Ustawienie niestandardowe",
                        uk: "Хибно: Стандартне налаштування Правда: Користувацьке налаштування",
                        "zh-cn": "否：标准设置 是：自定义设置",
                    },
                    type: "number",
                    role: "level",
                    write: true,
                    read: true,
                    min: 0,
                    max: 1,
                    def: 0,
                    states: {
                        0: "Use default settings",
                        1: "Use custom settings",
                    },
                },
                native: {},
            })
            .catch(error => {
                this.log.error(`Custom-Multi-Angle: ${error.name}: ${error.message}`);
            });
        const common = {
            name: {
                en: "Cutting Direction",
                de: "Schnittrichtung",
                ru: "Направление резки",
                pt: "Direção de corte",
                nl: "Snijrichting",
                fr: "Direction de coupe",
                it: "Direzione di taglio",
                es: "Dirección de corte",
                pl: "Kierunek cięcia",
                uk: "Напрямок різання",
                "zh-cn": "切割方向",
            },
            type: "number",
            role: "level",
            write: true,
            read: true,
            def: 0,
            states: {
                0: "default",
                1: "traceless",
                4: "multi-angle",
            },
        };
        await this.createDataPoint(`${this.iob.namespace}.${path}.plan_mode`, common, "state", null, null, null);
    },
    /**
     * @param {string} sn
     * @param {any} data
     */
    async createSettings(sn, data) {
        let common;
        if (data.night_work != null) {
            common = {
                name: {
                    en: "Mowing at night",
                    de: "Mähen bei Nacht",
                    ru: "Кошение травы ночью",
                    pt: "Cortar a grama à noite",
                    nl: "'s Nachts maaien",
                    fr: "Tondre la nuit",
                    it: "Falciare di notte",
                    es: "Cortar el césped por la noche.",
                    pl: "Koszenie w nocy",
                    uk: "Косіння вночі",
                    "zh-cn": "夜间割草",
                },
                type: "boolean",
                role: "switch",
                write: true,
                read: true,
                def: false,
            };
            this.emit("objectExists", `${sn}.settings.night_work`);
            await this.createDataPoint(
                `${this.iob.namespace}.${sn}.settings.night_work`,
                common,
                "state",
                null,
                null,
                null,
            );
        }
        if (data.custom_flag != null) {
            common = {
                name: {
                    en: "Custom Flag",
                    de: "Benutzerdefinierte Flagge",
                    ru: "Пользовательский флаг",
                    pt: "Bandeira personalizada",
                    nl: "Aangepaste vlag",
                    fr: "Drapeau personnalisé",
                    it: "Bandiera personalizzata",
                    es: "Bandera personalizada",
                    pl: "Flaga niestandardowa",
                    uk: "Спеціальний прапор",
                    "zh-cn": "自定义旗帜",
                },
                type: "boolean",
                role: "switch",
                write: true,
                read: true,
                def: false,
            };
            this.emit("objectExists", `${sn}.settings.custom_flag`);
            await this.createDataPoint(
                `${this.iob.namespace}.${sn}.settings.custom_flag`,
                common,
                "state",
                null,
                null,
                null,
            );
        }
        if (data.recharge_mode != null) {
            common = {
                name: {
                    en: "Docking Path",
                    de: "Andockpfad",
                    ru: "Путь стыковки",
                    pt: "Caminho de ancoragem",
                    nl: "Dokpad",
                    fr: "Chemin d'amarrage",
                    it: "Percorso di attracco",
                    es: "Ruta de acoplamiento",
                    pl: "Ścieżka dokowania",
                    uk: "Шлях стикування",
                    "zh-cn": "对接路径",
                },
                type: "number",
                role: "level",
                write: true,
                read: true,
                def: 0,
                states: {
                    0: "direct path",
                    1: "smart",
                    2: "along edge",
                },
            };
            this.emit("objectExists", `${sn}.settings.recharge_mode`);
            await this.createDataPoint(
                `${this.iob.namespace}.${sn}.settings.recharge_mode`,
                common,
                "state",
                null,
                null,
                null,
            );
        }
        if (data.work_touch_mode != null) {
            common = {
                name: {
                    en: "Obstacle Avoidance Strategy",
                    de: "Strategie zur Vermeidung von Hindernissen",
                    ru: "Стратегия избегания препятствий",
                    pt: "Estratégia para Evitar Obstáculos",
                    nl: "Obstakelvermijdingsstrategie",
                    fr: "Stratégie d'évitement des obstacles",
                    it: "Strategia di evitamento degli ostacoli",
                    es: "Estrategia para evitar obstáculos",
                    pl: "Strategia unikania przeszkód",
                    uk: "Стратегія уникнення перешкод",
                    "zh-cn": "避障策略",
                },
                type: "number",
                role: "level",
                write: true,
                read: true,
                def: 0,
                states: {
                    0: "no touch",
                    1: "slow touch",
                },
            };
            this.emit("objectExists", `${sn}.settings.work_touch_mode`);
            await this.createDataPoint(
                `${this.iob.namespace}.${sn}.settings.work_touch_mode`,
                common,
                "state",
                null,
                null,
                null,
            );
        }
        if (data.auto_ride_edge_map_m != null) {
            common = {
                name: {
                    en: "Automatic Edge Mapping",
                    de: "Automatische Kantenerkennung",
                    ru: "Автоматическое отображение границ",
                    pt: "Mapeamento automático de bordas",
                    nl: "Automatische randmapping",
                    fr: "Cartographie automatique des bords",
                    it: "Mappatura automatica dei bordi",
                    es: "Mapeo automático de bordes",
                    pl: "Automatyczne mapowanie krawędzi",
                    uk: "Автоматичне картографування країв",
                    "zh-cn": "自动边缘映射",
                },
                type: "number",
                role: "level",
                write: true,
                read: true,
                def: 0,
                states: {
                    0: "not enabled",
                    1: "enabled",
                },
            };
            this.emit("objectExists", `${sn}.settings.auto_ride_edge_map_m`);
            await this.createDataPoint(
                `${this.iob.namespace}.${sn}.settings.auto_ride_edge_map_m`,
                common,
                "state",
                null,
                null,
                null,
            );
        }
        if (data.dis_along_border != null) {
            common = {
                name: {
                    en: "Edge Distance",
                    de: "Randabstand",
                    ru: "Расстояние до края",
                    pt: "distância da borda",
                    nl: "Randafstand",
                    fr: "Distance au bord",
                    it: "Distanza dal bordo",
                    es: "Distancia al borde",
                    pl: "Odległość od krawędzi",
                    uk: "Відстань від краю",
                    "zh-cn": "边缘距离",
                },
                type: "number",
                role: "level",
                write: true,
                read: true,
                def: 0,
                states: {
                    0: "close",
                    1: "far",
                },
            };
            this.emit("objectExists", `${sn}.settings.dis_along_border`);
            await this.createDataPoint(
                `${this.iob.namespace}.${sn}.settings.dis_along_border`,
                common,
                "state",
                null,
                null,
                null,
            );
        }
        if (data.first_along_border != null) {
            common = {
                name: {
                    en: "Mowing Preference",
                    de: "Mähpräferenz",
                    ru: "Предпочтения по стрижке газона",
                    pt: "Preferência de corte de grama",
                    nl: "Voorkeur voor maaien",
                    fr: "Préférence de tonte",
                    it: "Preferenza di taglio",
                    es: "Preferencia de corte",
                    pl: "Preferencje dotyczące koszenia",
                    uk: "Уподобання щодо скошування",
                    "zh-cn": "割草偏好",
                },
                type: "boolean",
                role: "switch",
                write: true,
                read: true,
                def: false,
            };
            this.emit("objectExists", `${sn}.settings.first_along_border`);
            await this.createDataPoint(
                `${this.iob.namespace}.${sn}.settings.first_along_border`,
                common,
                "state",
                null,
                null,
                null,
            );
        }
        if (data.energy_saving_mode != null) {
            common = {
                name: {
                    en: "Energy saving mode",
                    de: "Energiesparmodus",
                    ru: "режим энергосбережения",
                    pt: "Modo de economia de energia",
                    nl: "Energiebesparende modus",
                    fr: "mode d'économie d'énergie",
                    it: "Modalità di risparmio energetico",
                    es: "Modo de ahorro de energía",
                    pl: "Tryb oszczędzania energii",
                    uk: "Режим енергозбереження",
                    "zh-cn": "节能模式",
                },
                type: "boolean",
                role: "switch",
                write: true,
                read: true,
                def: false,
            };
            this.emit("objectExists", `${sn}.settings.energy_saving_mode`);
            await this.createDataPoint(
                `${this.iob.namespace}.${sn}.settings.energy_saving_mode`,
                common,
                "state",
                null,
                null,
                null,
            );
        }
        if (data.follow_border_freq != null) {
            common = {
                name: {
                    en: "Edge Cutting Frequency",
                    de: "Kantenschneidfrequenz",
                    ru: "Частота резки кромок",
                    pt: "Frequência de corte de borda",
                    nl: "Snijfrequentie van de kanten",
                    fr: "Fréquence de coupe des bords",
                    it: "Frequenza di taglio del bordo",
                    es: "Frecuencia de corte de filo",
                    pl: "Częstotliwość cięcia krawędzi",
                    uk: "Частота різання країв",
                    "zh-cn": "边缘切削频率",
                },
                type: "number",
                role: "level",
                write: true,
                read: true,
                def: 1,
                states: {
                    1: "everytime",
                    2: "every second time",
                    3: "every third time",
                },
            };
            this.emit("objectExists", `${sn}.settings.follow_border_freq`);
            await this.createDataPoint(
                `${this.iob.namespace}.${sn}.settings.follow_border_freq`,
                common,
                "state",
                null,
                null,
                null,
            );
        }
        if (data.dev_name != null) {
            common = {
                name: {
                    en: "Device name",
                    de: "Name des Geräts",
                    ru: "Имя устройства",
                    pt: "Nome do dispositivo",
                    nl: "Apparaatnaam",
                    fr: "Nom du périphérique",
                    it: "Nome del dispositivo",
                    es: "Nombre del dispositivo",
                    pl: "Nazwa urządzenia",
                    uk: "Назва пристрою",
                    "zh-cn": "设备名称",
                },
                type: "string",
                role: "state",
                write: true,
                read: true,
            };
            this.emit("objectExists", `${sn}.settings.dev_name`);
            await this.createDataPoint(
                `${this.iob.namespace}.${sn}.settings.dev_name`,
                common,
                "state",
                null,
                null,
                null,
            );
        }
        /**
        if (data.dev_model != null) {
            common = {
                name: {
                    en: "Device model",
                    de: "Gerätemodell",
                    ru: "модель устройства",
                    pt: "Modelo do dispositivo",
                    nl: "Apparaatmodel",
                    fr: "Modèle d'appareil",
                    it: "Modello del dispositivo",
                    es: "Modelo de dispositivo",
                    pl: "Model urządzenia",
                    uk: "Модель пристрою",
                    "zh-cn": "设备型号",
                },
                type: "string",
                role: "state",
                write: true,
                read: true,
            };
            this.emit("objectExists", `${sn}.settings.dev_model`);
            await this.createDataPoint(
                `${this.iob.namespace}.${sn}.settings.dev_model`,
                common,
                "state",
                null,
                null,
                null,
            );
        }
         */
        if (data.ai_sensitivity != null) {
            common = {
                name: {
                    en: "AI sensitivity",
                    de: "KI-Sensitivität",
                    ru: "чувствительность ИИ",
                    pt: "Sensibilidade da IA",
                    nl: "AI-gevoeligheid",
                    fr: "sensibilité de l'IA",
                    it: "sensibilità dell'IA",
                    es: "Sensibilidad de la IA",
                    pl: "Wrażliwość AI",
                    uk: "Чутливість штучного інтелекту",
                    "zh-cn": "人工智能敏感性",
                },
                type: "number",
                role: "level",
                write: true,
                read: true,
                def: 0,
                states: {
                    0: "low",
                    1: "high",
                },
            };
            this.emit("objectExists", `${sn}.settings.ai_sensitivity`);
            await this.createDataPoint(
                `${this.iob.namespace}.${sn}.settings.ai_sensitivity`,
                common,
                "state",
                null,
                null,
                null,
            );
        }
        const meta = this.deviceMeta[sn];
        if (data.plan_angle != null && data.plan_angle.plan_mode != null) {
            common = {
                name: {
                    en: "Cutting Direction",
                    de: "Schnittrichtung",
                    ru: "Направление резки",
                    pt: "Direção de corte",
                    nl: "Snijrichting",
                    fr: "Direction de coupe",
                    it: "Direzione di taglio",
                    es: "Dirección de corte",
                    pl: "Kierunek cięcia",
                    uk: "Напрямок різання",
                    "zh-cn": "切割方向",
                },
                type: "number",
                role: "level",
                write: true,
                read: true,
                def: 0,
                states: {
                    0: "default",
                    1: "traceless",
                },
            };
            if (meta && meta.modelClass === "S") {
                common.states[4] = "multi-angle";
            }
            this.emit("objectExists", `${sn}.settings.plan_mode`);
            await this.createDataPoint(
                `${this.iob.namespace}.${sn}.settings.plan_mode`,
                common,
                "state",
                null,
                null,
                null,
            );
        }
        if (data.mow_efficiency != null && data.mow_efficiency.speed != null) {
            common = {
                name: {
                    en: "Mowing Speed",
                    de: "Mähgeschwindigkeit",
                    ru: "Скорость кошения",
                    pt: "Velocidade de corte",
                    nl: "Maaisnelheid",
                    fr: "Vitesse de tonte",
                    it: "Velocità di taglio",
                    es: "Velocidad de corte",
                    pl: "Prędkość koszenia",
                    uk: "Швидкість скошування",
                    "zh-cn": "割草速度",
                },
                type: "number",
                role: "level",
                write: true,
                read: true,
                def: 2,
                states: {
                    1: "slow",
                    2: "standard",
                    3: "fast",
                },
            };
            this.emit("objectExists", `${sn}.settings.workSpeed`);
            await this.createDataPoint(
                `${this.iob.namespace}.${sn}.settings.workSpeed`,
                common,
                "state",
                null,
                null,
                null,
            );
        }
        if (data.mow_efficiency != null && data.mow_efficiency.gap != null) {
            common = {
                name: {
                    en: "Cutting Spacing",
                    de: "Schneiden Abstand",
                    ru: "Расстояние между режущими инструментами",
                    pt: "Espaçamento de corte",
                    nl: "Snijafstand",
                    fr: "Espacement de coupe",
                    it: "Spazio di taglio",
                    es: "Espaciado de corte",
                    pl: "Odstępy między cięciami",
                    uk: "Інтервал різання",
                    "zh-cn": "切割间距",
                },
                type: "number",
                role: "level",
                write: true,
                read: true,
                def: 2,
                states: {
                    1: "narrow",
                    2: "standard",
                    3: "wide",
                },
            };
            this.emit("objectExists", `${sn}.settings.gap`);
            await this.createDataPoint(`${this.iob.namespace}.${sn}.settings.gap`, common, "state", null, null, null);
        }
        if (meta && (meta.modelClass === "S" || meta.modelClass === "X")) {
            common = {
                name: {
                    en: "Reset blade count",
                    de: "Klingenzähler zurücksetzen",
                    ru: "Сбросить счетчик лезвий",
                    pt: "Reiniciar contagem de lâminas",
                    nl: "Aantal messen resetten",
                    fr: "Réinitialiser le nombre de lames",
                    it: "Reimposta il conteggio delle lame",
                    es: "Reiniciar el contador de cuchillas",
                    pl: "Zresetuj liczbę ostrzy",
                    uk: "Скинути кількість лез",
                    "zh-cn": "重置刀片数量",
                },
                type: "boolean",
                role: "button",
                write: true,
                read: false,
                def: false,
            };
            this.emit("objectExists", `${sn}.settings.reset_blade`);
            await this.createDataPoint(
                `${this.iob.namespace}.${sn}.settings.reset_blade`,
                common,
                "state",
                null,
                null,
                null,
            );
            common = {
                name: {
                    en: "Reset bladeplate count",
                    de: "Klingenplattenzähler zurücksetzen",
                    ru: "Сбросить счетчик пластин лезвия",
                    pt: "Reiniciar contagem de lâminas",
                    nl: "Het aantal bladenplaten resetten",
                    fr: "Réinitialiser le nombre de plaques de lames",
                    it: "Reimposta il conteggio delle lame",
                    es: "Reiniciar el contador de placas de cuchillas",
                    pl: "Zresetuj liczbę płytek ostrza",
                    uk: "Скинути кількість лопатей",
                    "zh-cn": "重置刀片计数",
                },
                type: "boolean",
                role: "button",
                write: true,
                read: false,
                def: false,
            };
            this.emit("objectExists", `${sn}.settings.reset_bladeplate`);
            await this.createDataPoint(
                `${this.iob.namespace}.${sn}.settings.reset_bladeplate`,
                common,
                "state",
                null,
                null,
                null,
            );
            common = {
                name: {
                    en: "Reset bladeplate count",
                    de: "Klingenplattenzähler zurücksetzen",
                    ru: "Сбросить счетчик пластин лезвия",
                    pt: "Reiniciar contagem de lâminas",
                    nl: "Het aantal bladenplaten resetten",
                    fr: "Réinitialiser le nombre de plaques de lames",
                    it: "Reimposta il conteggio delle lame",
                    es: "Reiniciar el contador de placas de cuchillas",
                    pl: "Zresetuj liczbę płytek ostrza",
                    uk: "Скинути кількість лопатей",
                    "zh-cn": "重置刀片计数",
                },
                type: "boolean",
                role: "switch",
                write: true,
                read: true,
                def: false,
            };
            this.emit("objectExists", `${sn}.settings.auto_upgrade`);
            await this.createDataPoint(
                `${this.iob.namespace}.${sn}.settings.auto_upgrade`,
                common,
                "state",
                null,
                null,
                null,
            );
        }
        if (meta && (meta.modelClass === "X" || meta.gen === "Gen2" || meta.gen === "Gen3")) {
            common = {
                name: {
                    en: "Reset small blade count",
                    de: "Kleine Klingenanzahl zurücksetzen",
                    ru: "Сбросить счетчик малых лезвий",
                    pt: "Reiniciar contagem de lâminas pequenas",
                    nl: "Het aantal kleine mesjes resetten",
                    fr: "Réinitialiser le nombre de petites lames",
                    it: "Reimposta il conteggio delle lame piccole",
                    es: "Restablecer el contador de cuchillas pequeñas",
                    pl: "Zresetuj liczbę małych ostrzy",
                    uk: "Скинути кількість малих лез",
                    "zh-cn": "重置小刀片数量",
                },
                type: "boolean",
                role: "button",
                write: true,
                read: false,
                def: false,
            };
            this.emit("objectExists", `${sn}.settings.reset_smal_blade`);
            await this.createDataPoint(
                `${this.iob.namespace}.${sn}.settings.reset_smal_blade`,
                common,
                "state",
                null,
                null,
                null,
            );
            common = {
                name: {
                    en: "Reset small bladeplate count",
                    de: "Zähler für kleine Klingenplatten zurücksetzen",
                    ru: "Сбросить счетчик малых пластин лезвий",
                    pt: "Redefinir contagem de lâminas pequenas",
                    nl: "Reset het aantal kleine mesjes",
                    fr: "Réinitialiser le nombre de petites plaques à lames",
                    it: "Reimposta il conteggio delle piccole lame",
                    es: "Restablecer el contador de placas de cuchillas pequeñas",
                    pl: "Zresetuj liczbę małych płytek ostrza",
                    uk: "Скинути кількість малих лез",
                    "zh-cn": "重置小刀片计数",
                },
                type: "boolean",
                role: "button",
                write: true,
                read: false,
                def: false,
            };
            this.emit("objectExists", `${sn}.settings.reset_smal_bladeplate`);
            await this.createDataPoint(
                `${this.iob.namespace}.${sn}.settings.reset_smal_bladeplate`,
                common,
                "state",
                null,
                null,
                null,
            );
        }
    },
    /**
     * @param {string} sn
     */
    async createSettingsFW(sn) {
        let common;
        common = {
            name: {
                en: "available firmware",
                de: "verfügbare Firmware",
                ru: "доступная прошивка",
                pt: "firmware disponível",
                nl: "beschikbare firmware",
                fr: "micrologiciel disponible",
                it: "firmware disponibile",
                es: "firmware disponible",
                pl: "dostępne oprogramowanie układowe",
                uk: "доступна прошивка",
                "zh-cn": "可用固件",
            },
            type: "string",
            role: "state",
            write: false,
            read: true,
        };
        await this.createDataPoint(
            `${this.iob.namespace}.${sn}.settings.firmware_available`,
            common,
            "state",
            null,
            null,
            null,
        );

        common = {
            name: {
                en: "Firmware description",
                de: "Firmware-Beschreibung",
                ru: "Описание прошивки",
                pt: "Descrição do firmware",
                nl: "Firmwarebeschrijving",
                fr: "Description du firmware",
                it: "Descrizione del firmware",
                es: "Descripción del firmware",
                pl: "Opis oprogramowania sprzętowego",
                uk: "Опис прошивки",
                "zh-cn": "固件描述",
            },
            type: "string",
            role: "state",
            write: false,
            read: true,
        };
        await this.createDataPoint(
            `${this.iob.namespace}.${sn}.settings.firmware_description`,
            common,
            "state",
            null,
            null,
            null,
        );

        common = {
            name: {
                en: "Firmware update available",
                de: "Firmware-Update verfügbar",
                ru: "Доступно обновление прошивки",
                pt: "Atualização de firmware disponível",
                nl: "Firmware-update beschikbaar",
                fr: "Mise à jour du firmware disponible",
                it: "Aggiornamento del firmware disponibile",
                es: "Actualización de firmware disponible",
                pl: "Dostępna aktualizacja oprogramowania sprzętowego",
                uk: "Доступне оновлення прошивки",
                "zh-cn": "固件更新可用",
            },
            type: "boolean",
            role: "indicator",
            write: false,
            read: true,
            def: false,
        };
        await this.createDataPoint(
            `${this.iob.namespace}.${sn}.settings.firmware_update_available`,
            common,
            "state",
            null,
            null,
            null,
        );

        common = {
            name: {
                en: "Start firmware update",
                de: "Firmware-Update starten",
                ru: "Начать обновление прошивки",
                pt: "Iniciar atualização de firmware",
                nl: "Start de firmware-update",
                fr: "Lancer la mise à jour du firmware",
                it: "Avviare l'aggiornamento del firmware",
                es: "Iniciar actualización del firmware",
                pl: "Rozpocznij aktualizację oprogramowania układowego",
                uk: "Розпочати оновлення прошивки",
                "zh-cn": "开始固件更新",
            },
            type: "boolean",
            role: "button",
            write: true,
            read: false,
            def: false,
        };
        await this.createDataPoint(
            `${this.iob.namespace}.${sn}.settings.firmware_update_start`,
            common,
            "state",
            null,
            null,
            null,
        );

        common = {
            name: {
                en: "Manual check whether an update is available",
                de: "Manuelle Prüfung, ob ein Update verfügbar ist",
                ru: "Ручная проверка, доступно ли обновление",
                pt: "Verificar manualmente se uma atualização está disponível",
                nl: "Handmatig controleren of een update beschikbaar is",
                fr: "Vérifier manuellement si une mise à jour est disponible",
                it: "Verifica manuale se è disponibile un aggiornamento",
                es: "Comprobación manual si hay una actualización disponible",
                pl: "Ręczne sprawdzenie, czy dostępna jest aktualizacja",
                uk: "Перевірка інструкції, чи доступний оновлення",
                "zh-cn": "手动检查是否有更新",
            },
            type: "boolean",
            role: "button",
            write: true,
            read: false,
            def: false,
        };
        await this.createDataPoint(
            `${this.iob.namespace}.${sn}.settings.firmware_update_check_manual`,
            common,
            "state",
            null,
            null,
            null,
        );
    },

    /**
     * @param {string} sn
     */
    async ensureRemoteButtons(sn) {
        let common;
        common = {
            name: {
                en: "Commands",
                de: "Befehle",
                ru: "Команды",
                pt: "Comandos",
                nl: "Commando's",
                fr: "Commandes",
                it: "Comandi",
                es: "Comandos",
                pl: "Polecenia",
                uk: "Команди",
                "zh-cn": "命令",
            },
            icon: "img/mower.png",
        };
        await this.createDataPoint(`${this.iob.namespace}.${sn}.remote`, common, "channel", null, null, null);

        const buttons = [
            [
                "start",
                {
                    en: "Mowing start",
                    de: "Mähen starten",
                    ru: "Начало кошения",
                    pt: "Início da poda",
                    nl: "Maaien begint",
                    fr: "Début de la tonte",
                    it: "Inizio falciatura",
                    es: "Inicio del corte de césped",
                    pl: "Rozpoczęcie koszenia",
                    uk: "Початок скошування",
                    "zh-cn": "割草开始",
                },
            ],
            [
                "pause",
                {
                    en: "Pause",
                    de: "Pause",
                    ru: "Пауза",
                    pt: "Pausa",
                    nl: "Pauze",
                    fr: "Pause",
                    it: "Pausa",
                    es: "Pausa",
                    pl: "Pauza",
                    uk: "Пауза",
                    "zh-cn": "暂停",
                },
            ],
            [
                "dock",
                {
                    en: "To the Charging Station",
                    de: "Zur Ladestation",
                    ru: "К зарядной станции",
                    pt: "Para a estação de carregamento",
                    nl: "Naar het laadstation",
                    fr: "Vers la station de recharge",
                    it: "Alla stazione di ricarica",
                    es: "A la estación de carga",
                    pl: "Do stacji ładowania",
                    uk: "До зарядної станції",
                    "zh-cn": "前往充电站",
                },
            ],
            [
                "stop_find_charger",
                {
                    en: "Trip to home cancel",
                    de: "Heimreise abbrechen",
                    ru: "Отмена поездки домой",
                    pt: "Cancelamento da viagem para casa",
                    nl: "Reis naar huis geannuleerd",
                    fr: "Annulation du voyage à domicile",
                    it: "Annulla il viaggio verso casa",
                    es: "Cancelación del viaje a casa",
                    pl: "Odwołanie podróży do domu",
                    uk: "Скасувати поїздку додому",
                    "zh-cn": "取消回家行程",
                },
            ],
            [
                "border",
                {
                    en: "Edge cut run",
                    de: "Kantenschnittlauf",
                    ru: "Краевой срез",
                    pt: "corte de borda",
                    nl: "Randafsnijding",
                    fr: "Course de coupe de bord",
                    it: "Taglio del bordo",
                    es: "Corte de borde",
                    pl: "Cięcie krawędziowe",
                    uk: "Вирізання краю",
                    "zh-cn": "边缘切割",
                },
            ],
            [
                "stop",
                {
                    en: "Stop",
                    de: "Stoppen",
                    ru: "Останавливаться",
                    pt: "Parar",
                    nl: "Stop",
                    fr: "Arrêt",
                    it: "Fermare",
                    es: "Detener",
                    pl: "Zatrzymywać się",
                    uk: "СТІЙ",
                    "zh-cn": "停止",
                },
            ],
            [
                "stop_task",
                {
                    en: "Cancel Task",
                    de: "Aufgabe abbrechen",
                    ru: "Отменить задачу",
                    pt: "Cancelar tarefa",
                    nl: "Taak annuleren",
                    fr: "Annuler la tâche",
                    it: "Annulla attività",
                    es: "Cancelar tarea",
                    pl: "Anuluj zadanie",
                    uk: "Скасувати завдання",
                    "zh-cn": "取消任务",
                },
            ],
            [
                "restart",
                {
                    en: "Restart Task",
                    de: "Aufgabe neu starten",
                    ru: "Перезапустить задачу",
                    pt: "Reiniciar tarefa",
                    nl: "Taak opnieuw starten",
                    fr: "Tâche de redémarrage",
                    it: "Riavvia l'attività",
                    es: "Reiniciar tarea",
                    pl: "Uruchom ponownie zadanie",
                    uk: "Перезапустити завдання",
                    "zh-cn": "重启任务",
                },
            ],
            [
                "refresh",
                {
                    en: "Reload Status",
                    de: "Status neu laden",
                    ru: "Статус перезагрузки",
                    pt: "Recarregar status",
                    nl: "Herlaadstatus",
                    fr: "État du rechargement",
                    it: "Stato ricarica",
                    es: "Estado de recarga",
                    pl: "Status ponownego ładowania",
                    uk: "Стан поповнення",
                    "zh-cn": "重新加载状态",
                },
            ],
            [
                "refresh_property",
                {
                    en: "Reload Properties",
                    de: "Eigenschaften neu laden",
                    ru: "Перезагрузить свойства",
                    pt: "Recarregar propriedades",
                    nl: "Eigenschappen opnieuw laden",
                    fr: "Recharger les propriétés",
                    it: "Ricarica le proprietà",
                    es: "Recargar propiedades",
                    pl: "Załaduj ponownie właściwości",
                    uk: "Перезавантажити властивості",
                    "zh-cn": "重新加载属性",
                },
            ],
        ];
        const meta = this.deviceMeta[sn];
        for (const [id, name] of buttons) {
            common = {
                name: name,
                type: "boolean",
                role: "button",
                read: false,
                write: true,
                def: false,
            };
            if (id == "border") {
                if (meta && (meta.modelClass === "V" || this.options.apptype === "Old")) {
                    await this.createDataPoint(
                        `${this.iob.namespace}.${sn}.remote.${id}`,
                        common,
                        "state",
                        null,
                        null,
                        null,
                    );
                }
            } else if (id == "stop_task" || id == "restart") {
                if (meta && (meta.modelClass === "V" || this.options.apptype === "Old")) {
                    await this.createDataPoint(
                        `${this.iob.namespace}.${sn}.remote.${id}`,
                        common,
                        "state",
                        null,
                        null,
                        null,
                    );
                }
            } else {
                await this.createDataPoint(
                    `${this.iob.namespace}.${sn}.remote.${id}`,
                    common,
                    "state",
                    null,
                    null,
                    null,
                );
            }
        }
        if (meta && meta.modelClass === "S") {
            common = {
                name: {
                    en: "Mow specific zones. For all zones empty array [].",
                    de: "Bestimmte Zonen mähen. Für alle Zonen leeres Array [].",
                    ru: "Косить в определенных зонах. Для всех зон используйте пустой массив [].",
                    pt: "Cortar a grama em zonas específicas. Para todas as zonas, use um array vazio [].",
                    nl: "Maai specifieke zones. Voor alle zones een lege array [].",
                    fr: "Tondre des zones spécifiques. Pour toutes les zones, videz le tableau [].",
                    it: "Falcia zone specifiche. Per tutte le zone, array vuoto [].",
                    es: "Cortar zonas específicas. Para todas las zonas, matriz vacía [].",
                    pl: "Koszenie określonych stref. Dla wszystkich stref pusta tablica [].",
                    uk: "Скошувати певні зони. Для всіх зон порожній масив [].",
                    "zh-cn": "修剪特定区域。所有区域均为空数组 []。",
                },
                type: "array",
                role: "list",
                read: true,
                write: true,
                def: JSON.stringify([]),
            };
            this.emit("objectExists", `${sn}.remote.startZones`);
            await this.createDataPoint(
                `${this.iob.namespace}.${sn}.remote.startZones`,
                common,
                "state",
                null,
                null,
                null,
            );
        }
        if (meta && meta.modelClass === "V1") {
            common = {
                name: {
                    en: "Automatic screen switch-off",
                    de: "Automatische Bildschirmabschaltung",
                    ru: "Автоматическое отключение экрана",
                    pt: "Desligamento automático do ecrã",
                    nl: "Automatische uitschakeling van het scherm",
                    fr: "Extinction automatique de l'écran",
                    it: "Spegnimento automatico dello schermo",
                    es: "Apagado automático de la pantalla",
                    pl: "Automatyczne wyłączanie ekranu",
                    uk: "Автоматичне вимкнення екрана",
                    "zh-cn": "自动屏幕关闭",
                },
                type: "number",
                role: "level",
                read: true,
                write: true,
                def: 0,
                states: {
                    0: "off",
                    30: "30",
                    60: "60",
                    90: "90",
                },
            };
            this.emit("objectExists", `${sn}.remote.set_screen_durration`);
            await this.createDataPoint(
                `${this.iob.namespace}.${sn}.remote.set_screen_durration`,
                common,
                "state",
                null,
                null,
                null,
            );
            common = {
                name: {
                    en: "Docking mode",
                    de: "Andockmodus",
                    ru: "Режим стыковки",
                    pt: "Modo de acoplamento",
                    nl: "Koppelingsmodus",
                    fr: "Mode d'amarrage",
                    it: "Modalità di aggancio",
                    es: "Modo de acoplamiento",
                    pl: "Tryb dokowania",
                    uk: "Режим стикування",
                    "zh-cn": "对接模式",
                },
                type: "number",
                role: "level",
                read: true,
                write: true,
                def: 0,
                states: {
                    0: "Smart",
                    1: "Traceless",
                },
            };
            this.emit("objectExists", `${sn}.remote.set_return_path`);
            await this.createDataPoint(
                `${this.iob.namespace}.${sn}.remote.set_return_path`,
                common,
                "state",
                null,
                null,
                null,
            );
            common = {
                name: {
                    en: "Edge cut first",
                    de: "Zuerst die Kante schneiden",
                    ru: "Сначала обрезать край",
                    pt: "Cortar primeiro pela borda",
                    nl: "Eerst de rand afsnijden",
                    fr: "Commencer par couper le bord",
                    it: "Tagliare prima il bordo",
                    es: "Cortar primero por el borde",
                    pl: "Najpierw przyciąć krawędź",
                    uk: "Спочатку обріжте край",
                    "zh-cn": "先切边缘",
                },
                type: "number",
                role: "level",
                read: true,
                write: true,
                def: 0,
                states: {
                    0: "off",
                    1: "on",
                },
            };
            this.emit("objectExists", `${sn}.remote.set_border_first`);
            await this.createDataPoint(
                `${this.iob.namespace}.${sn}.remote.set_border_first`,
                common,
                "state",
                null,
                null,
                null,
            );
            common = {
                name: {
                    en: "Edge cut distance",
                    de: "Schnittabstand",
                    ru: "Расстояние обрезки края",
                    pt: "distância de corte da borda",
                    nl: "Randafsnijafstand",
                    fr: "distance de coupe du bord",
                    it: "distanza di taglio del bordo",
                    es: "Distancia de corte del borde",
                    pl: "Odległość cięcia krawędzi",
                    uk: "Відстань відрізу краю",
                    "zh-cn": "边缘切割距离",
                },
                type: "number",
                role: "level",
                read: true,
                write: true,
                def: 0,
                states: {
                    0: "far",
                    1: "close",
                },
            };
            this.emit("objectExists", `${sn}.remote.set_border_distance`);
            await this.createDataPoint(
                `${this.iob.namespace}.${sn}.remote.set_border_distance`,
                common,
                "state",
                null,
                null,
                null,
            );
        }
    },
    /**
     * @param {string} sn
     */
    async ensureOwnRequestStates(sn) {
        let common;
        common = {
            name: {
                en: "Custom HTTP request",
                de: "Benutzerdefinierte HTTP-Anfrage",
                ru: "Пользовательский HTTP-запрос",
                pt: "Requisição HTTP personalizada",
                nl: "Aangepaste HTTP-aanvraag",
                fr: "Requête HTTP personnalisée",
                it: "Richiesta HTTP personalizzata",
                es: "Solicitud HTTP personalizada",
                pl: "Niestandardowe żądanie HTTP",
                uk: "Користувацький HTTP-запит",
                "zh-cn": "自定义 HTTP 请求",
            },
            icon: "img/expert.png",
        };
        await this.createDataPoint(`${this.iob.namespace}.${sn}.expert`, common, "channel", null, null, null);

        common = {
            name: {
                en: "Own HTTP request",
                de: "Eigene HTTP-Anfrage",
                ru: "Собственный HTTP-запрос",
                pt: "Solicitação HTTP própria",
                nl: "Eigen HTTP-verzoek",
                fr: "Requête HTTP propre",
                it: "Richiesta HTTP propria",
                es: "Solicitud HTTP propia",
                pl: "Własne żądanie HTTP",
                uk: "Власний HTTP-запит",
                "zh-cn": "自有 HTTP 请求",
            },
            type: "string",
            role: "json",
            read: true,
            write: true,
            def: JSON.stringify({ method: "get", url: "", headers: {}, data: null, auth: true }),
        };
        await this.createDataPoint(`${this.iob.namespace}.${sn}.expert.request`, common, "state", null, null, null);

        common = {
            name: {
                en: "HTTP request response",
                de: "HTTP-Anfrage-Antwort",
                ru: "HTTP-запрос ответ",
                pt: "Resposta da solicitação HTTP",
                nl: "HTTP-verzoekreactie",
                fr: "réponse à la requête HTTP",
                it: "risposta alla richiesta HTTP",
                es: "Solicitud HTTP y respuesta",
                pl: "Odpowiedź na żądanie HTTP",
                uk: "Відповідь на HTTP-запит",
                "zh-cn": "HTTP 请求响应",
            },
            type: "string",
            role: "json",
            read: true,
            write: false,
            def: JSON.stringify({}),
        };
        await this.createDataPoint(`${this.iob.namespace}.${sn}.expert.response`, common, "state", null, null, null);
    },
    /**
     * @param {string} sn
     */
    async ensureScheduleStates(sn) {
        let common;
        common = {
            name: {
                en: "Schedule Planner",
                de: "Terminplaner",
                ru: "Планировщик расписаний",
                pt: "Planejador de Horários",
                nl: "Planningsplanner",
                fr: "Planificateur d'horaire",
                it: "Pianificatore di programmi",
                es: "Planificador de horarios",
                pl: "Planer harmonogramu",
                uk: "Планувальник розкладу",
                "zh-cn": "日程规划器",
            },
            icon: "img/schedule.png",
        };
        await this.createDataPoint(`${this.iob.namespace}.${sn}.schedule`, common, "channel", null, null, null);

        const meta = this.deviceMeta[sn];
        const channel_name = {
            0: {
                en: "Sunday",
                de: "Sonntag",
                ru: "Воскресенье",
                pt: "Domingo",
                nl: "Zondag",
                fr: "Dimanche",
                it: "Domenica",
                es: "Domingo",
                pl: "Niedziela",
                uk: "Неділя",
                "zh-cn": "星期日",
            },
            1: {
                en: "Monday",
                de: "Montag",
                ru: "Понедельник",
                pt: "Segunda-feira",
                nl: "Maandag",
                fr: "Lundi",
                it: "Lunedi",
                es: "Lunes",
                pl: "Poniedziałek",
                uk: "Понеділок",
                "zh-cn": "周一",
            },
            2: {
                en: "Tuesday",
                de: "Dienstag",
                ru: "Вторник",
                pt: "Terça-feira",
                nl: "Dinsdag",
                fr: "Mardi",
                it: "Martedì",
                es: "Martes",
                pl: "Wtorek",
                uk: "Вівторок",
                "zh-cn": "周二",
            },
            3: {
                en: "Wednesday",
                de: "Mittwoch",
                ru: "Среда",
                pt: "Quarta-feira",
                nl: "Woensdag",
                fr: "Mercredi",
                it: "Mercoledì",
                es: "Miércoles",
                pl: "Środa",
                uk: "Середа",
                "zh-cn": "周三",
            },
            4: {
                en: "Thursday",
                de: "Donnerstag",
                ru: "Четверг",
                pt: "Quinta-feira",
                nl: "Donderdag",
                fr: "Jeudi",
                it: "Giovedì",
                es: "Jueves",
                pl: "Czwartek",
                uk: "Четвер",
                "zh-cn": "周四",
            },
            5: {
                en: "Friday",
                de: "Freitag",
                ru: "Пятница",
                pt: "Sexta-feira",
                nl: "Vrijdag",
                fr: "Vendredi",
                it: "Venerdì",
                es: "Viernes",
                pl: "Piątek",
                uk: "П'ятниця",
                "zh-cn": "星期五",
            },
            6: {
                en: "Saturday",
                de: "Samstag",
                ru: "Суббота",
                pt: "Sábado",
                nl: "Zaterdag",
                fr: "Samedi",
                it: "Sabato",
                es: "Sábado",
                pl: "Sobota",
                uk: "Субота",
                "zh-cn": "周六",
            },
        };
        const day_channel = {
            1: "1_monday",
            2: "2_tuesday",
            3: "3_wednesday",
            4: "4_thursday",
            5: "5_friday",
            6: "6_saturday",
            0: "0_sunday",
        };
        const days = [0, 1, 2, 3, 4, 5, 6];
        for (const day of days) {
            await this.createScheduleObject(sn, channel_name[day], day_channel[day], 1);
            if (meta && (meta.modelClass === "S" || meta.modelClass === "X")) {
                await this.createScheduleObject(sn, channel_name[day], day_channel[day], 2);
            }
        }
        common = {
            name: {
                en: "Schedule paused",
                de: "Zeitplan pausiert",
                ru: "Расписание приостановлено",
                pt: "Programação pausada",
                nl: "Planning gepauzeerd",
                fr: "Programme suspendu",
                it: "Programma sospeso",
                es: "Programación pausada",
                pl: "Harmonogram wstrzymany",
                uk: "Розклад призупинено",
                "zh-cn": "行程暂停",
            },
            type: "boolean",
            role: "switch",
            read: true,
            write: true,
            def: false,
        };
        await this.createDataPoint(
            `${this.iob.namespace}.${sn}.schedule.pauseSchedule`,
            common,
            "state",
            null,
            null,
            null,
        );

        common = {
            name: {
                en: "Reload mowing schedule",
                de: "Mähplan neu laden",
                ru: "Перезагрузить график кошения",
                pt: "Recarregar cronograma de corte de grama",
                nl: "Herlaad het maaischema",
                fr: "Recharger le calendrier de tonte",
                it: "Ricarica il programma di falciatura",
                es: "Programa de recarga de siega",
                pl: "Załaduj ponownie harmonogram koszenia",
                uk: "Оновити графік скошування",
                "zh-cn": "重新加载割草计划",
            },
            type: "boolean",
            role: "button",
            read: false,
            write: true,
            def: false,
        };
        await this.createDataPoint(
            `${this.iob.namespace}.${sn}.schedule.getSchedule`,
            common,
            "state",
            null,
            null,
            null,
        );

        common = {
            name: {
                en: "Send schedule",
                de: "Zeitplan senden",
                ru: "Отправить расписание",
                pt: "Enviar cronograma",
                nl: "Schema verzenden",
                fr: "Envoyer le planning",
                it: "Invia programma",
                es: "Enviar horario",
                pl: "Wyślij harmonogram",
                uk: "Надіслати розклад",
                "zh-cn": "发送日程安排",
            },
            type: "boolean",
            role: "button",
            read: false,
            write: true,
            def: false,
        };
        await this.createDataPoint(
            `${this.iob.namespace}.${sn}.schedule.setSchedule`,
            common,
            "state",
            null,
            null,
            null,
        );

        if (meta && (meta.modelClass === "S" || meta.modelClass === "X")) {
            common = {
                name: {
                    en: "Time work to repeat",
                    de: "Zeitarbeit wiederholen",
                    ru: "Время для работы, чтобы повторить",
                    pt: "Tempo de trabalho para repetir",
                    nl: "Tijd om te herhalen",
                    fr: "Il faut répéter le travail.",
                    it: "Tempo di lavoro da ripetere",
                    es: "El tiempo de trabajo se repite",
                    pl: "Praca nad czasem do powtórzenia",
                    uk: "Час роботи для повторення",
                    "zh-cn": "重复工作的时间",
                },
                type: "boolean",
                role: "switch",
                write: true,
                read: true,
                def: false,
            };
            await this.createDataPoint(
                `${this.iob.namespace}.${sn}.schedule.schedule_time_work_repeat`,
                common,
                "state",
                null,
                null,
                null,
            );
            this.emit("objectExists", `${sn}.schedule.schedule_time_work_repeat`);
            common = {
                name: {
                    en: "Schedule Mode",
                    de: "Zeitplanmodus",
                    ru: "Режим расписания",
                    pt: "Modo de agendamento",
                    nl: "Planningsmodus",
                    fr: "Mode de planification",
                    it: "Modalità di pianificazione",
                    es: "Modo de programación",
                    pl: "Tryb harmonogramu",
                    uk: "Режим розкладу",
                    "zh-cn": "计划模式",
                },
                type: "number",
                role: "level",
                write: true,
                read: true,
                def: 1,
                states: {
                    0: "no schedule",
                    1: "recomended",
                    2: "custom",
                },
            };
            await this.createDataPoint(
                `${this.iob.namespace}.${sn}.schedule.schedule_mode`,
                common,
                "state",
                null,
                null,
                null,
            );
            this.emit("objectExists", `${sn}.schedule.schedule_mode`);
            common = {
                name: {
                    en: "Time zone for schedule",
                    de: "Zeitzone für den Zeitplan",
                    ru: "Часовой пояс для расписания",
                    pt: "Fuso horário para a programação",
                    nl: "Tijdzone voor het schema",
                    fr: "Fuseau horaire pour l'horaire",
                    it: "Fuso orario per la programmazione",
                    es: "Zona horaria para el horario",
                    pl: "Strefa czasowa dla harmonogramu",
                    uk: "Часовий пояс для розкладу",
                    "zh-cn": "日程安排的时区",
                },
                type: "number",
                role: "level",
                write: true,
                read: true,
                def: 3600,
            };
            await this.createDataPoint(
                `${this.iob.namespace}.${sn}.schedule.schedule_time_zone`,
                common,
                "state",
                null,
                null,
                null,
            );
            this.emit("objectExists", `${sn}.schedule.schedule_time_zone`);
            common = {
                name: {
                    en: "zones available",
                    de: "verfügbare Zonen",
                    ru: "доступные зоны",
                    pt: "zonas disponíveis",
                    nl: "beschikbare zones",
                    fr: "zones disponibles",
                    it: "zone disponibili",
                    es: "zonas disponibles",
                    pl: "dostępne strefy",
                    uk: "доступні зони",
                    "zh-cn": "可用区域",
                },
                type: "string",
                role: "state",
                read: true,
                write: false,
                def: JSON.stringify([]),
            };
            await this.createDataPoint(
                `${this.iob.namespace}.${sn}.schedule.zones_available`,
                common,
                "state",
                null,
                null,
                null,
            );
            this.emit("objectExists", `${sn}.schedule.zones_available`);
        }
    },
    /**
     * @param {string} sn
     * @param {any} channel_name
     * @param {string} day_channel
     * @param {number} schedule
     */
    async createScheduleObject(sn, channel_name, day_channel, schedule) {
        let common;
        common = {
            name: channel_name,
            icon: "img/schedule.png",
        };
        await this.createDataPoint(
            `${this.iob.namespace}.${sn}.schedule.${day_channel}_${schedule}`,
            common,
            "channel",
            null,
            null,
            null,
        );
        common = {
            name: {
                en: "Start (HH:MM, empty = off)",
                de: "Start (HH:MM, leer = aus)",
                ru: "Старт (ЧЧ:ММ, пусто = выключено)",
                pt: "Início (HH:MM, vazio = desligado)",
                nl: "Start (HH:MM, leeg = uit)",
                fr: "Démarrer (HH:MM, vide = désactivé)",
                it: "Inizio (HH:MM, vuoto = spento)",
                es: "Inicio (HH:MM, vacío = apagado)",
                pl: "Start (GG:MM, puste = wyłączone)",
                uk: "Початок (ГГ:ХХ, порожній = вимкнено)",
                "zh-cn": "开始（时:分，空 = 关闭）",
            },
            type: "string",
            role: "text",
            read: true,
            write: true,
            def: "",
        };
        await this.createDataPoint(
            `${this.iob.namespace}.${sn}.schedule.${day_channel}_${schedule}.start`,
            common,
            "state",
            null,
            null,
            null,
        );
        common = {
            name: {
                en: "End (HH:MM, empty = off)",
                de: "Ende (HH:MM, leer = aus)",
                ru: "Конец (ЧЧ:ММ, пусто = выключено)",
                pt: "Fim (HH:MM, vazio = desligado)",
                nl: "Einde (HH:MM, leeg = uit)",
                fr: "Fin (HH:MM, vide = désactivé)",
                it: "Fine (HH:MM, vuoto = spento)",
                es: "Fin (HH:MM, vacío = apagado)",
                pl: "Koniec (GG:MM, puste = wyłączone)",
                uk: "Кінець (ГГ:ХХ, порожньо = вимкнено)",
                "zh-cn": "结束（HH:MM，空 = 关闭）",
            },
            type: "string",
            role: "text",
            read: true,
            write: true,
            def: "",
        };
        await this.createDataPoint(
            `${this.iob.namespace}.${sn}.schedule.${day_channel}_${schedule}.end`,
            common,
            "state",
            null,
            null,
            null,
        );
        common = {
            name: {
                en: "Unlock",
                de: "Entsperren",
                ru: "Разблокировать",
                pt: "Desbloquear",
                nl: "Ontgrendelen",
                fr: "Ouvrir",
                it: "Sbloccare",
                es: "Descubrir",
                pl: "Odblokować",
                uk: "Розблокувати",
                "zh-cn": "开锁",
            },
            type: "boolean",
            role: "switch",
            read: true,
            write: true,
            def: false,
        };
        await this.createDataPoint(
            `${this.iob.namespace}.${sn}.schedule.${day_channel}_${schedule}.unlock`,
            common,
            "state",
            null,
            null,
            null,
        );
        common = {
            name: {
                en: "Zones e.g. [12536,148597] empty = all",
                de: "Zonen z. Bsp. [12536,148597] leer = alle",
                ru: "Зоны, например, [12536,148597] пусты = все",
                pt: "Zonas, por exemplo, [12536,148597] vazias = todas",
                nl: "Zones bijv. [12536,148597] leeg = alles",
                fr: "Zones par exemple [12536,148597] vides = toutes",
                it: "Zone ad esempio [12536,148597] vuote = tutte",
                es: "Zonas, por ejemplo [12536,148597] vacías = todas",
                pl: "Strefy np. [12536,148597] puste = wszystkie",
                uk: "Зони, наприклад, [12536,148597] порожні = всі",
                "zh-cn": "区域示例 [12536,148597] 为空 = 全部",
            },
            type: "string",
            role: "json",
            read: true,
            write: true,
            def: JSON.stringify([]),
        };
        await this.createDataPoint(
            `${this.iob.namespace}.${sn}.schedule.${day_channel}_${schedule}.zones`,
            common,
            "state",
            null,
            null,
            null,
        );
        common = {
            name: {
                en: "Active",
                de: "Aktiv",
                ru: "Активный",
                pt: "Ativo",
                nl: "Actief",
                fr: "Actif",
                it: "Attivo",
                es: "Activo",
                pl: "Aktywny",
                uk: "Активний",
                "zh-cn": "积极的",
            },
            type: "boolean",
            role: "indicator",
            read: true,
            write: false,
            def: false,
        };
        await this.createDataPoint(
            `${this.iob.namespace}.${sn}.schedule.${day_channel}_${schedule}.active`,
            common,
            "state",
            null,
            null,
            null,
        );
        common = {
            name: {
                en: "Work order",
                de: "Arbeitsauftrag",
                ru: "Заказ на выполнение работ",
                pt: "Ordem de serviço",
                nl: "Werkorder",
                fr: "ordre de travail",
                it: "Ordine di lavoro",
                es: "Orden de trabajo",
                pl: "Zlecenie pracy",
                uk: "Наряд-замовлення",
                "zh-cn": "工作单",
            },
            type: "number",
            role: "level",
            read: true,
            write: true,
            def: 0,
        };
        await this.createDataPoint(
            `${this.iob.namespace}.${sn}.schedule.${day_channel}_${schedule}.work_order`,
            common,
            "state",
            null,
            null,
            null,
        );
        common = {
            name: {
                en: "Need follow border",
                de: "Grenze beachten.",
                ru: "Необходимо следовать границе",
                pt: "É preciso seguir a fronteira.",
                nl: "U moet de grens volgen",
                fr: "Il faut suivre la frontière",
                it: "Bisogna rispettare il confine",
                es: "Es necesario seguir la frontera.",
                pl: "Trzeba przestrzegać granicy",
                uk: "Потрібно дотримуватися кордону",
                "zh-cn": "需要沿着边界",
            },
            type: "boolean",
            role: "switch",
            read: true,
            write: true,
            def: false,
        };
        await this.createDataPoint(
            `${this.iob.namespace}.${sn}.schedule.${day_channel}_${schedule}.need_follow_border`,
            common,
            "state",
            null,
            null,
            null,
        );
    },
    /**
     * @param {string} sn
     * @param {any} data
     * @param {any} isAvailable
     */
    async setStates(sn, data, isAvailable) {
        if (data.night_work != null && isAvailable[`${sn}.settings.night_work`]) {
            await this.iob.setState(`${sn}.settings.night_work`, { val: data.night_work, ack: true });
        }
        if (data.recharge_mode != null && isAvailable[`${sn}.settings.night_work`]) {
            await this.iob.setState(`${sn}.settings.recharge_mode`, { val: data.recharge_mode, ack: true });
        }
        if (data.work_touch_mode != null && isAvailable[`${sn}.settings.night_work`]) {
            await this.iob.setState(`${sn}.settings.work_touch_mode`, { val: data.work_touch_mode, ack: true });
        }
        if (data.auto_ride_edge_map_m != null && isAvailable[`${sn}.settings.night_work`]) {
            await this.iob.setState(`${sn}.settings.auto_ride_edge_map_m`, {
                val: data.auto_ride_edge_map_m,
                ack: true,
            });
        }
        if (data.dis_along_border != null && isAvailable[`${sn}.settings.night_work`]) {
            await this.iob.setState(`${sn}.settings.dis_along_border`, { val: data.dis_along_border, ack: true });
        }
        if (data.first_along_border != null && isAvailable[`${sn}.settings.first_along_border`]) {
            await this.iob.setState(`${sn}.settings.first_along_border`, { val: data.first_along_border, ack: true });
        }
        if (data.ai_sensitivity != null && isAvailable[`${sn}.settings.ai_sensitivity`]) {
            await this.iob.setState(`${sn}.settings.ai_sensitivity`, { val: data.ai_sensitivity, ack: true });
        }
        if (data.custom_flag != null && isAvailable[`${sn}.settings.custom_flag`]) {
            await this.iob.setState(`${sn}.settings.custom_flag`, { val: data.custom_flag, ack: true });
        }
        if (data.map_temp_name != null && isAvailable[`${sn}.map.zones.change_active_map_name`]) {
            await this.iob.setState(`${sn}.map.zones.change_active_map_name`, { val: data.map_temp_name, ack: true });
        }
        if ((data.auto_upgrade != null || data.autoUpgrade != null) && isAvailable[`${sn}.settings.auto_upgrade`]) {
            const auto = data.auto_upgrade != null ? data.auto_upgrade : data.autoUpgrade;
            await this.iob.setState(`${sn}.settings.auto_upgrade`, { val: auto, ack: true });
        }
        if (
            (data.time_zone != null || data.wirelessTimeZone != null) &&
            isAvailable[`${sn}.schedule.schedule_time_zone`]
        ) {
            const tz = data.time_zone != null ? data.time_zone : data.wirelessTimeZone;
            await this.iob.setState(`${sn}.schedule.schedule_time_zone`, { val: tz, ack: true });
            const meta = this.deviceMeta[sn];
            meta.time_zone = tz;
        }
        if (data.time_work_repeat != null) {
            await this.iob.setState(`${sn}.schedule.schedule_time_work_repeat`, {
                val: data.time_work_repeat,
                ack: true,
            });
        }
        if (data.docking_path != null && isAvailable[`${sn}.remote.set_return_path`]) {
            await this.iob.setState(`${sn}.settings.set_return_path`, { val: data.docking_path, ack: true });
        }
        if (data.border_first != null && isAvailable[`${sn}.remote.set_border_first`]) {
            await this.iob.setState(`${sn}.settings.set_border_first`, { val: data.border_first, ack: true });
        }
        if (data.border_distance != null && isAvailable[`${sn}.remote.set_border_distance`]) {
            await this.iob.setState(`${sn}.settings.set_border_distance`, { val: data.border_distance, ack: true });
        }
        if (data.screen_lock != null && isAvailable[`${sn}.remote.set_screen_durration`]) {
            await this.iob.setState(`${sn}.settings.set_screen_durration`, { val: data.screen_lock, ack: true });
        }
        if (data.follow_border_freq != null && isAvailable[`${sn}.settings.follow_border_freq`]) {
            await this.iob.setState(`${sn}.settings.follow_border_freq`, { val: data.follow_border_freq, ack: true });
        }
        if (data.plan_angle != null && data.plan_angle.plan_mode != null && isAvailable[`${sn}.settings.plan_mode`]) {
            await this.iob.setState(`${sn}.settings.plan_mode`, { val: data.plan_angle.plan_mode, ack: true });
        }
        if (
            data.mow_efficiency != null &&
            data.mow_efficiency.speed != null &&
            isAvailable[`${sn}.settings.workSpeed`]
        ) {
            await this.iob.setState(`${sn}.settings.workSpeed`, { val: data.mow_efficiency.speed, ack: true });
        }
        if (data.mow_efficiency != null && data.mow_efficiency.gap != null && isAvailable[`${sn}.settings.gap`]) {
            await this.iob.setState(`${sn}.settings.gap`, { val: data.mow_efficiency.gap, ack: true });
        }
        if (data.dev_name != null && isAvailable[`${sn}.settings.dev_name`]) {
            await this.iob.setState(`${sn}.settings.dev_name`, { val: data.dev_name, ack: true });
        }
        //if (data.dev_model != null && isAvailable[`${sn}.settings.dev_model`]) {
        //    await this.iob.setState(`${sn}.settings.dev_model`, { val: data.dev_model, ack: true });
        //}
        if (data.energy_saving_mode != null && isAvailable[`${sn}.settings.energy_saving_mode`]) {
            await this.iob.setState(`${sn}.settings.energy_saving_mode`, { val: data.energy_saving_mode, ack: true });
        }
        if (data.rain != null) {
            if (data.rain.rain_flag != null) {
                await this.iob.setState(`${sn}.settings.rainFlag`, { val: data.rain.rain_flag, ack: true });
            }
            if (data.rain.delay != null) {
                await this.iob.setState(`${sn}.settings.rainDelayDuration`, { val: data.rain.delay, ack: true });
            }
        }
        if (data.bladeHeight != null || (data.blade && data.blade.height != null)) {
            const val = data.bladeHeight != null ? data.bladeHeight : data.blade.height;
            await this.iob.setState(`${sn}.settings.bladeHeight`, { val: val, ack: true });
        }
        if (data.bladeSpeed != null || (data.blade && data.blade.speed != null)) {
            const val = data.bladeSpeed != null ? data.bladeSpeed : data.blade.speed;
            await this.iob.setState(`${sn}.settings.bladeSpeed`, { val: val, ack: true });
        }
    },
    /**
     * @param {string} message
     * @returns {object|boolean};
     */
    availableMessageSettings(message) {
        const messages = {
            emile: false,
            emailNotice: false,
            rabbitException: false,
            feedbackNotice: false,
            trackNotice: false,
            noticeMessage: false,
            serverPlacardMessage: false,
            deviceExceptionMessage: {
                en: "Work irregularities",
                de: "Arbeitsunregelmäßigkeiten",
                ru: "Нарушения трудового законодательства",
                pt: "Irregularidades no trabalho",
                nl: "Onregelmatigheden in het werk",
                fr: "irrégularités au travail",
                it: "Irregolarità lavorative",
                es: "Irregularidades laborales",
                pl: "Nieprawidłowości w pracy",
                uk: "Порушення в роботі",
                "zh-cn": "工作违规行为",
            },
            trackWarningMessage: {
                en: "Tracking",
                de: "Tracking",
                ru: "Отслеживание",
                pt: "Monitorando",
                nl: "Volgen",
                fr: "Suivi",
                it: "Tracciamento",
                es: "Seguimiento",
                pl: "Śledzenie",
                uk: "Відстеження",
                "zh-cn": "追踪",
            },
            taskStatus: {
                en: "Task status",
                de: "Aufgabenstatus",
                ru: "Статус задачи",
                pt: "Status da tarefa",
                nl: "Taakstatus",
                fr: "État de la tâche",
                it: "Stato dell'attività",
                es: "Estado de la tarea",
                pl: "Status zadania",
                uk: "Стан завдання",
                "zh-cn": "任务状态",
            },
            commonMesgage: {
                en: "General News",
                de: "Allgemeine Nachrichten",
                ru: "Общие новости",
                pt: "Notícias Gerais",
                nl: "Algemeen nieuws",
                fr: "Actualités générales",
                it: "Notizie generali",
                es: "Noticias generales",
                pl: "Wiadomości ogólne",
                uk: "Загальні новини",
                "zh-cn": "综合新闻",
            },
            communityActivityMessage: {
                en: "Recommended events",
                de: "Empfohlene Veranstaltungen",
                ru: "Рекомендуемые мероприятия",
                pt: "Eventos recomendados",
                nl: "Aanbevolen evenementen",
                fr: "Événements recommandés",
                it: "Eventi consigliati",
                es: "Eventos recomendados",
                pl: "Polecane wydarzenia",
                uk: "Рекомендовані події",
                "zh-cn": "推荐活动",
            },
            deadLineWarnMessageCutter: {
                en: "Mowing cutter",
                de: "Mähwerk",
                ru: "косилка",
                pt: "cortador de grama",
                nl: "Maaiers",
                fr: "Coupe-tondeuse",
                it: "Falciatrice",
                es: "Cortadora de césped",
                pl: "Kosiarka",
                uk: "Косарка",
                "zh-cn": "割草机",
            },
            deadLineWarnMessageBlade: {
                en: "Blade",
                de: "Klinge",
                ru: "Лезвие",
                pt: "Lâmina",
                nl: "Blad",
                fr: "Lame",
                it: "Lama",
                es: "Cuchilla",
                pl: "Ostrze",
                uk: "Лезо",
                "zh-cn": "刀刃",
            },
            deadLineWarnTrimmerRope: {
                en: "Trimmer Rope",
                de: "Trimmerseil",
                ru: "Трос для триммера",
                pt: "Corda de corte",
                nl: "Trimmertouw",
                fr: "Corde de débroussailleuse",
                it: "Corda per tagliasiepi",
                es: "Cuerda de desbrozadora",
                pl: "Lina trymera",
                uk: "Трос для тримера",
                "zh-cn": "修剪绳",
            },
            smallDeadLineWarnMessageBlade: {
                en: "Small blade",
                de: "Kleine Klinge",
                ru: "Маленькое лезвие",
                pt: "Lâmina pequena",
                nl: "Klein mesje",
                fr: "petite lame",
                it: "Lama piccola",
                es: "Hoja pequeña",
                pl: "Małe ostrze",
                uk: "Маленьке лезо",
                "zh-cn": "小刀片",
            },
            smallDeadLineWarnMessageCutter: {
                en: "Mowing Cutter small",
                de: "Mähwerk klein",
                ru: "Косилка-резак маленькая",
                pt: "Cortador de grama pequeno",
                nl: "Maaiermachine klein",
                fr: "petite tondeuse",
                it: "Tagliabordi piccolo",
                es: "Cortadora de césped pequeña",
                pl: "Kosiarka mała",
                uk: "Маленький різак для косіння",
                "zh-cn": "小型割草机",
            },
        };
        return typeof messages[message] === "object" ? messages[message] : false;
    },
    /**
     * @param {string} ident Object
     * @param {any} common Common States
     * @param {"state" | "folder" | "channel" | "device"} types Object Type
     * @param {string | number | boolean | null | undefined} value Set Value
     * @param {boolean | null | undefined} extend Use extend or setObject
     * @param {any} native Object Nativ
     */
    async createDataPoint(ident, common, types, value, extend, native) {
        try {
            const nativvalue = !native ? { native: {} } : { native: native };
            const obj = await this.iob.getObjectAsync(ident);
            if (!obj) {
                await this.iob
                    .setObjectNotExistsAsync(ident, {
                        type: types,
                        common: common,
                        ...nativvalue,
                    })
                    .catch(error => {
                        this.iob.log.warn(`createDataPoint: ${error}`);
                    });
            } else {
                let ischange = false;
                if (extend) {
                    let countStates = 0;
                    if (obj.common && common && common.states == null && obj.common.states != null) {
                        countStates = 1;
                    }
                    this.iob.log.debug(`countStates: ${countStates}`);
                    if (Object.keys(common).length > Object.keys(obj.common || {}).length - countStates) {
                        ischange = true;
                    } else {
                        for (const key in common) {
                            if (JSON.stringify(obj.common[key]) !== JSON.stringify(common[key])) {
                                ischange = true;
                                break;
                            }
                        }
                    }
                    if (JSON.stringify(obj.type) !== JSON.stringify(types)) {
                        ischange = true;
                    }
                    if (ischange) {
                        this.iob.log.debug(`INFORMATION - Extend common: ${this.iob.namespace}.${ident}`);
                        await this.iob.extendObject(ident, {
                            type: types,
                            common: common,
                            ...nativvalue,
                        });
                    }
                    if (value != null) {
                        await this.iob.setState(ident, value, true);
                    }
                    return;
                }
                if (Object.keys(common).length > Object.keys(obj.common).length) {
                    ischange = true;
                } else {
                    for (const key in common) {
                        if (obj.common[key] == null) {
                            ischange = true;
                            break;
                        } else if (JSON.stringify(obj.common[key]) != JSON.stringify(common[key])) {
                            ischange = true;
                            break;
                        }
                    }
                }
                if (JSON.stringify(obj.type) != JSON.stringify(types)) {
                    ischange = true;
                }
                if (native) {
                    if (Object.keys(obj.native).length == Object.keys(nativvalue.native).length) {
                        for (const key in obj.native) {
                            if (nativvalue.native[key] == null) {
                                ischange = true;
                                delete obj.native;
                                obj.native = native;
                                break;
                            } else if (JSON.stringify(obj.native[key]) != JSON.stringify(nativvalue.native[key])) {
                                ischange = true;
                                obj.native[key] = nativvalue.native[key];
                                break;
                            }
                        }
                    } else {
                        ischange = true;
                    }
                }
                if (ischange) {
                    this.iob.log.debug(`INFORMATION - Change common: ${this.iob.namespace}.${ident}`);
                    delete obj.common;
                    obj.common = common;
                    obj.type = types;
                    await this.iob.setObject(ident, obj);
                }
            }
            if (value != null) {
                await this.iob.setState(ident, value, true);
            }
        } catch (error) {
            if (typeof error === "string") {
                this.iob.log.error(`createDataPoint: ${error}`);
            } else if (error instanceof Error) {
                this.iob.log.error(`createDataPoint: ${error.name}: ${error.message}`);
            }
        }
    },
};

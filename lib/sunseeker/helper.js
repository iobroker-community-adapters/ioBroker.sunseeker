"use strict";

module.exports = {
    /**
     * @param {string} sn
     */
    async createFence(sn) {
        const common = {
            name: {
                en: "Anti-Theft",
                de: "Diebstahlschutz",
                ru: "Противоугонная система",
                pt: "Antifurto",
                nl: "Diefstalbeveiliging",
                fr: "Système antivol",
                it: "Antifurto",
                es: "Sistema antirrobo",
                pl: "Antykradzieżowy",
                uk: "Антикрадіжка",
                "zh-cn": "防盗",
            },
            desc: "Create by Adapter",
            icon: "img/anti-theft.png",
        };
        await this.createDataPoint(`${this.iob.namespace}.${sn}.antiTheft`, common, "channel", null, null, null);
    },
    /**
     * @param {string} sn
     * @param {any} isAvailable
     */
    async addTopUp(sn, isAvailable) {
        if (this.topUp) {
            if (!isAvailable[`${sn}.settings.topUp`]) {
                const common = {
                    type: "boolean",
                    role: "switch",
                    name: {
                        en: "Devices for the home page in the app",
                        de: "Geräte für die Startseite in der App",
                        ru: "Устройства для отображения главной страницы в приложении",
                        pt: "Dispositivos para a página inicial no aplicativo",
                        nl: "Apparaten voor de startpagina in de app",
                        fr: "Appareils pour la page d'accueil dans l'application",
                        it: "Dispositivi per la pagina iniziale nell'app",
                        es: "Dispositivos para la página de inicio en la aplicación",
                        pl: "Urządzenia dla strony głównej w aplikacji",
                        uk: "Пристрої для головної сторінки в додатку",
                        "zh-cn": "应用首页的设备",
                    },
                    desc: "Create by Adapter",
                    read: true,
                    write: true,
                    def: false,
                };
                await this.createDataPoint(
                    `${this.iob.namespace}.${sn}.settings.topUp`,
                    common,
                    "state",
                    null,
                    null,
                    null,
                );
                this.emit("objectExists", `${sn}.settings.topUp`);
            }
            if (!isAvailable[`${sn}.settings.topUp_array`]) {
                const common = {
                    type: "string",
                    role: "json",
                    name: {
                        en: "Sorting of devices for the view in the app",
                        de: "Sortierung der Geräte für die Ansicht in der App",
                        ru: "Сортировка устройств для отображения в приложении.",
                        pt: "Classificação dos dispositivos para visualização no aplicativo",
                        nl: "Sortering van apparaten voor de weergave in de app",
                        fr: "Tri des appareils pour l'affichage dans l'application",
                        it: "Ordinamento dei dispositivi per la visualizzazione nell'app",
                        es: "Ordenación de dispositivos para la visualización en la aplicación",
                        pl: "Sortowanie urządzeń do widoku w aplikacji",
                        uk: "Сортування пристроїв для перегляду в додатку",
                        "zh-cn": "应用视图中的设备排序",
                    },
                    desc: "Create by Adapter",
                    read: true,
                    write: true,
                    def: JSON.stringify([]),
                };
                await this.createDataPoint(
                    `${this.iob.namespace}.${sn}.settings.topUp_array`,
                    common,
                    "state",
                    null,
                    null,
                    null,
                );
                this.emit("objectExists", `${sn}.settings.topUp_array`);
            }
            const meta = this.deviceMeta[sn];
            if (meta && meta.topUp != null) {
                await this.iob.setState(`${sn}.settings.topUp`, { val: meta.topUp, ack: true });
            }
            await this.iob.setState(`${sn}.settings.topUp_array`, {
                val: JSON.stringify(this.topUpArrayDeviceSn),
                ack: true,
            });
        } else {
            if (isAvailable[`${sn}.settings.topUp`]) {
                this.emit("deleteObjectExists", `${sn}.settings.topUp`);
                await this.iob.delObjectAsync(`${this.iob.namespace}.${sn}.settings.topUp`, {
                    recursive: true,
                });
            }
            if (isAvailable[`${sn}.settings.topUp_array`]) {
                this.emit("deleteObjectExists", `${sn}.settings.topUp_array`);
                await this.iob.delObjectAsync(`${this.iob.namespace}.${sn}.settings.topUp_array`, {
                    recursive: true,
                });
            }
        }
    },
    /**
     * @param {string} sn
     * @param {any} states
     * @param {boolean | null} [extend]
     */
    async updateShareApplyInvite(sn, states, extend) {
        const req = await this.iob.getObjectAsync(`${sn}.sharing.share_apply_invite`);
        const new_states = {
            none: "none",
            ...states,
        };
        let is_empty = true;
        if (req && req.common && req.common.states) {
            if (Object.keys(req.common.states).length > 1) {
                is_empty = false;
                extend = null;
                for (const state in req.common.states) {
                    if (req.common.states[state] != "none") {
                        const split_time = req.common.states[state].split("<time>");
                        if (split_time[1] && !this.inviteCheck24h(split_time[1])) {
                            new_states[state] = req.common.states[state];
                        }
                    }
                }
            }
        }
        if (Object.keys(new_states).length == 1 && is_empty) {
            return;
        }
        const common = {
            type: "string",
            role: "state",
            name: {
                en: "Accept invitation",
                de: "Einladung annehmen",
                ru: "Примите приглашение",
                pt: "Aceitar convite",
                nl: "Uitnodiging accepteren",
                fr: "Accepter l'invitation",
                it: "Accetti l'invito",
                es: "Aceptar invitación",
                pl: "Przyjmij zaproszenie",
                uk: "Прийняти запрошення",
                "zh-cn": "接受邀请",
            },
            desc: "Create by Adapter",
            read: true,
            write: true,
            def: "none",
            states: new_states,
        };
        await this.createDataPoint(
            `${this.iob.namespace}.${sn}.sharing.share_apply_invite`,
            common,
            "state",
            "none",
            extend,
            null,
        );
    },

    /**
     * @param {string} sn
     */
    async ensureProfileStatesSN(sn) {
        let common;
        common = {
            name: {
                en: "Profile",
                de: "Profil",
                ru: "Профиль",
                pt: "Perfil",
                nl: "Profiel",
                fr: "Profil",
                it: "Profilo",
                es: "Perfil",
                pl: "Profil",
                uk: "Профіль",
                "zh-cn": "轮廓",
            },
            icon: "img/profile.png",
        };
        await this.createDataPoint(`${this.iob.namespace}.${sn}.profile`, common, "channel", null, null, null);
        common = {
            name: {
                en: "Change time zone",
                de: "Zeitzone ändern",
                ru: "Изменить часовой пояс",
                pt: "Mudar fuso",
                nl: "Tijdzone wijzigen",
                fr: "Changer de fuseau",
                it: "Cambia ora",
                es: "Cambiar huso horario",
                pl: "Zmień strefę czasową",
                uk: "Змінити часовий пояс",
                "zh-cn": "更改时区",
            },
            icon: "img/time.png",
        };
        await this.createDataPoint(`${this.iob.namespace}.${sn}.profile.timezone`, common, "channel", null, null, null);
        common = {
            type: "boolean",
            role: "switch",
            name: {
                en: "Enable/disable automatic daylight saving time",
                de: "Automatische Sommerzeit aktivieren/deaktivieren",
                ru: "Включить/отключить автоматическое переключение на летнее время",
                pt: "Ativar/desativar o horário de verão automático",
                nl: "Automatische zomertijd in-/uitschakelen",
                fr: "Activer/désactiver le passage automatique à l'heure d'été",
                it: "Attiva/disattiva l'ora legale automatica",
                es: "Activar/desactivar el horario de verano automático",
                pl: "Włącz/wyłącz automatyczną zmianę czasu na letni",
                uk: "Увімкнути/вимкнути автоматичний перехід на літній час",
                "zh-cn": "启用/禁用自动夏令时",
            },
            desc: "Create by Adapter",
            read: true,
            write: true,
            def: false,
        };
        await this.createDataPoint(
            `${this.iob.namespace}.${sn}.profile.timezone.daylight_time_auto_set`,
            common,
            "state",
            false,
            null,
            null,
        );
        common = {
            type: "boolean",
            role: "switch",
            name: {
                en: "Daylight time enable/disable",
                de: "Sommerzeit ein-/ausschalten",
                ru: "Включение/выключение дневного времени",
                pt: "Ativar/desativar o horário",
                nl: "Daglichttijd inschakelen/uitschakelen",
                fr: "Activer/désactiver l'heure d'été",
                it: "Attiva/disattiva ora legale",
                es: "Activar/desactivar la hora de verano",
                pl: "Włączanie/wyłączanie czasu letniego",
                uk: "Включення/вимкнення літнього часу",
                "zh-cn": "夏令时启用/禁用",
            },
            desc: "Create by Adapter",
            read: true,
            write: true,
            def: false,
        };
        await this.createDataPoint(
            `${this.iob.namespace}.${sn}.profile.timezone.daylight_time_enable`,
            common,
            "state",
            false,
            null,
            null,
        );
        common = {
            type: "string",
            role: "state",
            name: {
                en: "Change time zone",
                de: "Zeitzone ändern",
                ru: "Изменить часовой пояс",
                pt: "Mudar fuso",
                nl: "Tijdzone wijzigen",
                fr: "Changer de fuseau",
                it: "Cambia ora",
                es: "Cambiar huso horario",
                pl: "Zmień strefę czasową",
                uk: "Змінити часовий пояс",
                "zh-cn": "更改时区",
            },
            desc: "Create by Adapter",
            read: true,
            write: true,
            def: "",
            states: this.timezoneCode(),
        };
        await this.createDataPoint(
            `${this.iob.namespace}.${sn}.profile.timezone.changeTimezone`,
            common,
            "state",
            "",
            null,
            null,
        );
        common = {
            name: {
                en: "Wifi information",
                de: "WLAN-Informationen",
                ru: "Информация о Wi-Fi",
                pt: "Informações sobre Wi-Fi",
                nl: "Wifi-informatie",
                fr: "Informations sur le Wi-Fi",
                it: "Informazioni sul Wi-Fi",
                es: "Información sobre wifi",
                pl: "Informacje o Wi-Fi",
                uk: "Інформація про Wi-Fi",
                "zh-cn": "无线网络信息",
            },
            icon: "img/wifi.png",
        };
        await this.createDataPoint(`${this.iob.namespace}.${sn}.profile.wifi`, common, "channel", null, null, null);
    },

    async ensureProfileStates() {
        let common;
        common = {
            name: {
                en: "Profile",
                de: "Profil",
                ru: "Профиль",
                pt: "Perfil",
                nl: "Profiel",
                fr: "Profil",
                it: "Profilo",
                es: "Perfil",
                pl: "Profil",
                uk: "Профіль",
                "zh-cn": "轮廓",
            },
            icon: "img/profile.png",
        };
        await this.createDataPoint(`${this.iob.namespace}.profile`, common, "channel", null, null, null);
        /**
        common = {
            name: {
                en: "Change password",
                de: "Kennwort ändern",
                ru: "Изменить пароль",
                pt: "Alterar a senha",
                nl: "Wachtwoord wijzigen",
                fr: "Changer le mot de passe",
                it: "Cambiare la password",
                es: "Cambiar la contraseña",
                pl: "Zmień hasło",
                uk: "Змінити пароль",
                "zh-cn": "更改密码",
            },
            icon: "img/pw.png",
        };
        await this.createDataPoint(`${this.iob.namespace}.profile.password`, common, "channel", null, null, null);
        common = {
            name: {
                en: "Change email",
                de: "E-Mail-Adresse ändern",
                ru: "Изменить адрес электронной почты",
                pt: "Alterar e-mail",
                nl: "E-mailadres wijzigen",
                fr: "Changer d'adresse e-mail",
                it: "Cambia email",
                es: "Cambiar correo electrónico",
                pl: "Zmień adres e-mail",
                uk: "Змінити електронну пошту",
                "zh-cn": "更改电子邮件",
            },
            icon: "img/mail.png",
        };
        await this.createDataPoint(`${this.iob.namespace}.profile.mail`, common, "channel", null, null, null);
         */
        common = {
            name: {
                en: "Country/Region",
                de: "Land/Region",
                ru: "Страна/регион",
                pt: "País/região",
                nl: "Land/regio",
                fr: "Pays/région",
                it: "Paese/Regione",
                es: "País o región",
                pl: "Kraj/Region",
                uk: "Країна/регіон",
                "zh-cn": "国家/地区",
            },
            icon: "img/country.png",
        };
        await this.createDataPoint(`${this.iob.namespace}.profile.country`, common, "channel", null, null, null);
        common = {
            type: "string",
            role: "state",
            name: {
                en: "Select Country/Region",
                de: "Land/Region wählen",
                ru: "Выберите страну/регион",
                pt: "Escolha país/região",
                nl: "Selecteer land/regio",
                fr: "Choisissez un pays/une région",
                it: "Scelga Paese/Regione",
                es: "Seleccione un país o región",
                pl: "Wybierz Kraj/Region",
                uk: "Виберіть країну/регіон",
                "zh-cn": "选择国家/地区",
            },
            desc: "Create by Adapter",
            read: true,
            write: true,
            def: "DE",
            states: this.getRegionISO(),
        };
        await this.createDataPoint(`${this.iob.namespace}.profile.country.country`, common, "state", "", null, null);
        /**
        this.emit("objectExists", `profile.country.country`);
        common = {
            type: "string",
            role: "state",
            name: {
                en: "Enter old password",
                de: "Altes Passwort eingeben",
                ru: "Введите старый пароль",
                pt: "Digite a senha antiga",
                nl: "Voer het oude wachtwoord in",
                fr: "Saisissez votre ancien mot de passe",
                it: "Inserisci la vecchia password",
                es: "Introduzca la contraseña anterior",
                pl: "Wprowadź stare hasło",
                uk: "Введіть старий пароль",
                "zh-cn": "输入旧密码",
            },
            desc: "Create by Adapter",
            read: true,
            write: true,
            def: "",
        };
        await this.createDataPoint(
            `${this.iob.namespace}.profile.password.step1_oldPassword`,
            common,
            "state",
            "",
            null,
            null,
        );
        common = {
            type: "string",
            role: "state",
            name: {
                en: "Enter new password",
                de: "Neues Passwort eingeben",
                ru: "Введите новый пароль",
                pt: "Digite a nova senha",
                nl: "Voer een nieuw wachtwoord in",
                fr: "Saisissez le nouveau mot de passe",
                it: "Inserisci la nuova password",
                es: "Introduzca la nueva contraseña",
                pl: "Wprowadź nowe hasło",
                uk: "Введіть новий пароль",
                "zh-cn": "输入新密码",
            },
            desc: "Create by Adapter",
            read: true,
            write: true,
            def: "",
        };
        await this.createDataPoint(
            `${this.iob.namespace}.profile.password.step2_newPassword`,
            common,
            "state",
            "",
            null,
            null,
        );
        common = {
            type: "string",
            role: "state",
            name: {
                en: "Repeat new password",
                de: "Neues Passwort wiederholen",
                ru: "Повторите новый пароль",
                pt: "Repita a nova senha",
                nl: "Herhaal nieuw wachtwoord",
                fr: "Répétez le nouveau mot de passe",
                it: "Ripeti la nuova password",
                es: "Repita la nueva contraseña",
                pl: "Powtórz nowe hasło",
                uk: "Повторіть новий пароль",
                "zh-cn": "重复新密码",
            },
            desc: "Create by Adapter",
            read: true,
            write: true,
            def: "",
        };
        await this.createDataPoint(
            `${this.iob.namespace}.profile.password.step3_newPassword_repeat`,
            common,
            "state",
            "",
            null,
            null,
        );
        common = {
            type: "string",
            role: "state",
            name: {
                en: "Message",
                de: "Nachricht",
                ru: "Сообщение",
                pt: "Mensagem",
                nl: "Bericht",
                fr: "Message",
                it: "Messaggio",
                es: "Mensaje",
                pl: "Wiadomość",
                uk: "Повідомлення",
                "zh-cn": "信息",
            },
            desc: "Create by Adapter",
            read: true,
            write: false,
            def: "",
        };
        await this.createDataPoint(
            `${this.iob.namespace}.profile.password.step4_message`,
            common,
            "state",
            "",
            null,
            null,
        );
        common = {
            type: "string",
            role: "state",
            name: {
                en: "Enter new email address",
                de: "Neue E-Mail-Adresse eingeben",
                ru: "Введите новый адрес электронной почты",
                pt: "Insira um novo endereço de e-mail",
                nl: "Voer een nieuw e-mailadres in",
                fr: "Saisissez votre nouvelle adresse e-mail",
                it: "Inserisci il nuovo indirizzo email",
                es: "Introduzca una nueva dirección de correo electrónico",
                pl: "Wprowadź nowy adres e-mail",
                uk: "Введіть нову адресу електронної пошти",
                "zh-cn": "输入新的电子邮件地址",
            },
            desc: "Create by Adapter",
            read: true,
            write: true,
            def: "",
        };
        await this.createDataPoint(
            `${this.iob.namespace}.profile.mail.step1_newEmail`,
            common,
            "state",
            "",
            null,
            null,
        );
        common = {
            type: "boolean",
            role: "button",
            name: {
                en: "New email check",
                de: "Neue E-Mails prüfen",
                ru: "Новая проверка электронной почты",
                pt: "Nova verificação de e-mail",
                nl: "Nieuwe e-mailcontrole",
                fr: "Nouvelle vérification des e-mails",
                it: "Nuovo controllo email",
                es: "Nueva comprobación de correo electrónico",
                pl: "Nowe sprawdzenie poczty e-mail",
                uk: "Нова перевірка електронної пошти",
                "zh-cn": "新邮件检查",
            },
            desc: "Create by Adapter",
            read: false,
            write: true,
            def: false,
        };
        await this.createDataPoint(
            `${this.iob.namespace}.profile.mail.step2_checkNewEmail`,
            common,
            "state",
            false,
            null,
            null,
        );
        common = {
            type: "string",
            role: "text",
            name: {
                en: "Random string",
                de: "Zufällige Zeichenkette",
                ru: "Случайная строка",
                pt: "sequência aleatória",
                nl: "Willekeurige tekenreeks",
                fr: "Chaîne aléatoire",
                it: "stringa casuale",
                es: "Cadena aleatoria",
                pl: "Losowy ciąg znaków",
                uk: "Випадковий рядок",
                "zh-cn": "随机字符串",
            },
            desc: "Create by Adapter",
            read: true,
            write: false,
            def: "",
        };
        await this.createDataPoint(
            `${this.iob.namespace}.profile.mail.step3_randomString`,
            common,
            "state",
            "",
            null,
            null,
        );
        common = {
            type: "boolean",
            role: "button",
            name: {
                en: "Received verification code via email",
                de: "Bestätigungscode per E-Mail erhalten",
                ru: "Код подтверждения получен по электронной почте.",
                pt: "Recebi o código de verificação por e-mail.",
                nl: "Verificatiecode via e-mail ontvangen.",
                fr: "J'ai reçu le code de vérification par courriel.",
                it: "Codice di verifica ricevuto via email",
                es: "Recibí el código de verificación por correo electrónico.",
                pl: "Otrzymano kod weryfikacyjny e-mailem",
                uk: "Отримано код підтвердження електронною поштою",
                "zh-cn": "已通过电子邮件收到验证码",
            },
            desc: "Create by Adapter",
            read: false,
            write: true,
            def: false,
        };
        await this.createDataPoint(
            `${this.iob.namespace}.profile.mail.step4_createVerificationCode`,
            common,
            "state",
            false,
            null,
            null,
        );
        common = {
            type: "string",
            role: "state",
            name: {
                en: "Enter verification code",
                de: "Geben Sie den Bestätigungscode ein.",
                ru: "Введите проверочный код",
                pt: "Insira o código de verificação",
                nl: "Voer de verificatiecode in.",
                fr: "Saisissez le code de vérification",
                it: "Inserisci il codice di verifica",
                es: "Introduzca el código de verificación",
                pl: "Wprowadź kod weryfikacyjny",
                uk: "Введіть код підтвердження",
                "zh-cn": "请输入验证码",
            },
            desc: "Create by Adapter",
            read: true,
            write: true,
            def: "",
        };
        await this.createDataPoint(
            `${this.iob.namespace}.profile.mail.step5_verificationCode`,
            common,
            "state",
            "",
            null,
            null,
        );
        common = {
            type: "boolean",
            role: "button",
            name: {
                en: "Change Email",
                de: "E-Mail-Adresse ändern",
                ru: "Изменить адрес электронной почты",
                pt: "Alterar e-mail",
                nl: "E-mailadres wijzigen",
                fr: "Changer d'adresse e-mail",
                it: "Cambia email",
                es: "Cambiar correo electrónico",
                pl: "Zmień adres e-mail",
                uk: "Змінити електронну пошту",
                "zh-cn": "更改电子邮件",
            },
            desc: "Create by Adapter",
            read: false,
            write: true,
            def: false,
        };
        await this.createDataPoint(
            `${this.iob.namespace}.profile.mail.step6_changeEmail`,
            common,
            "state",
            false,
            null,
            null,
        );
        common = {
            type: "string",
            role: "state",
            name: {
                en: "Message",
                de: "Nachricht",
                ru: "Сообщение",
                pt: "Mensagem",
                nl: "Bericht",
                fr: "Message",
                it: "Messaggio",
                es: "Mensaje",
                pl: "Wiadomość",
                uk: "Повідомлення",
                "zh-cn": "信息",
            },
            desc: "Create by Adapter",
            read: true,
            write: false,
            def: "",
        };
        await this.createDataPoint(`${this.iob.namespace}.profile.mail.step7_message`, common, "state", "", null, null);
         */
    },

    /**
     * @param {string} sn
     */
    async addSharing(sn) {
        let common;
        common = {
            name: {
                en: "Sharing and Managing",
                de: "Teilen und verwalten",
                ru: "Совместное использование и управление",
                pt: "Partilhar e gerir",
                nl: "Delen en beheren",
                fr: "Partage et gestion",
                it: "Condividere e gestire",
                es: "Compartir y gestionar",
                pl: "Udostępnianie i zarządzanie",
                uk: "Спільне використання та керування",
                "zh-cn": "共享和管理",
            },
            icon: "img/share.png",
        };
        await this.createDataPoint(`${this.iob.namespace}.${sn}.sharing`, common, "channel", null, null, null);
        const states = {
            none: "none",
        };
        for (const raw of Object.values(this.devicesRaw)) {
            if (raw.ownerAppUserId) {
                states[raw.deviceId] = raw.dev_name;
            }
        }
        common = {
            type: "string",
            role: "state",
            name: {
                en: "Select device for delete",
                de: "Gerät zum Löschen auswählen",
                ru: "Выберите устройство для удаления",
                pt: "Selecione o dispositivo para excluir",
                nl: "Selecteer het apparaat dat u wilt verwijderen.",
                fr: "Sélectionnez l'appareil à supprimer",
                it: "Seleziona il dispositivo da eliminare",
                es: "Seleccione el dispositivo para eliminar",
                pl: "Wybierz urządzenie do usunięcia",
                uk: "Виберіть пристрій для видалення",
                "zh-cn": "选择要删除的设备",
            },
            desc: "Create by Adapter",
            read: true,
            write: true,
            def: "none",
            states: states,
        };
        await this.createDataPoint(
            `${this.iob.namespace}.${sn}.sharing.select_device`,
            common,
            "state",
            "none",
            null,
            null,
        );
        common = {
            name: {
                en: "Device sharing management",
                de: "Verwaltung der Gerätesharing",
                ru: "Управление совместным использованием устройств",
                pt: "Gestão da partilha de dispositivos",
                nl: "Beheer van het delen van apparaten",
                fr: "Gestion du partage d'appareils",
                it: "Gestione dei device",
                es: "Gestión de dispositivos",
                pl: "Zarządzanie udostępnianiem urządzeń",
                uk: "Управління загальним доступом пристроїв",
                "zh-cn": "设备共享管理",
            },
            icon: "img/share.png",
        };
        await this.createDataPoint(
            `${this.iob.namespace}.${sn}.sharing.share_user`,
            common,
            "channel",
            null,
            null,
            null,
        );
        common = {
            type: "string",
            role: "state",
            name: {
                en: "Email address to be invited",
                de: "Einladende E-Mail",
                ru: "Адрес электронной почты для приглашения",
                pt: "E-mail a ser convidado",
                nl: "E-mailadres om uitgenodigd te worden",
                fr: "Adresse e-mail à inviter",
                it: "Email da invitare",
                es: "Correo electrónico a invitar",
                pl: "Adres e-mail do zaproszenia",
                uk: "Адреса електронної пошти для запрошення",
                "zh-cn": "待邀请的电子邮件地址",
            },
            desc: "Create by Adapter",
            read: true,
            write: true,
            def: "",
        };
        await this.createDataPoint(`${this.iob.namespace}.${sn}.sharing.share_email`, common, "state", "", null, null);
        common = {
            type: "boolean",
            role: "button",
            name: {
                en: "Sharing send",
                de: "Teilen senden",
                ru: "Поделиться отправить",
                pt: "Partilhar e enviar",
                nl: "Delen, verzenden",
                fr: "Partage et envoi",
                it: "Share send",
                es: "Compartir enviar",
                pl: "Udostępnianie wysyłania",
                uk: "Спільне надсилання",
                "zh-cn": "分享发送",
            },
            desc: "Create by Adapter",
            read: false,
            write: true,
            def: false,
        };
        await this.createDataPoint(
            `${this.iob.namespace}.${sn}.sharing.share_send`,
            common,
            "state",
            false,
            null,
            null,
        );
        common = {
            type: "boolean",
            role: "button",
            name: {
                en: "Delete selected device",
                de: "Ausgewähltes Gerät löschen",
                ru: "Удалить выбранное устройство",
                pt: "Excluir dispositivo selecionado",
                nl: "Verwijder het geselecteerde apparaat",
                fr: "Supprimer le périphérique sélectionné",
                it: "Elimina il dispositivo selezionato",
                es: "Eliminar dispositivo seleccionado",
                pl: "Usuń wybrane urządzenie",
                uk: "Видалити вибраний пристрій",
                "zh-cn": "删除选定的设备",
            },
            desc: "Create by Adapter",
            read: false,
            write: true,
            def: false,
        };
        await this.createDataPoint(
            `${this.iob.namespace}.${sn}.sharing.select_device_delete`,
            common,
            "state",
            false,
            null,
            null,
        );
        const val = {
            none: "none",
        };
        await this.updateShareApplyInvite(sn, val);
    },
    /**
     * @param {string} sn
     * @param {any} data
     * @param {string} objChannel
     * @param {string} objName
     * @param {any} lang
     * @param {any} name
     * @param {any} isAvailable
     */
    async addDeleteObject(sn, data, objChannel, objName, lang, name, isAvailable) {
        if (!Array.isArray(data)) {
            return;
        }
        const objs = await this.iob.getChannelsAsync();
        const id_length = `${this.iob.namespace}.${sn}.map.${objChannel}.0`.length + 1;
        const obj = objs.filter(
            m => m._id.includes(`${this.iob.namespace}.${sn}.map.${objChannel}.0`) && m._id.length == id_length,
        );
        this.log.debug(`addDeleteObject: ${objChannel} - ${JSON.stringify(obj)}`);
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
            if (!isAvailable[path]) {
                this.emit("objectExists", path);
                const new_name = JSON.parse(JSON.stringify(name).replace(/<nr>/gu, `${a}`));
                await this.iob.extendObject(path, {
                    common: {
                        name: new_name,
                    },
                });
            }
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
                this.emit("clearCache", `${sn}.map.${objChannel}.${counter}`);
                this.emit("deleteObjectExists", `${sn}.map.${objChannel}.${counter}`);
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
            role: "level.color.rgbw",
            name: {
                en: "Pattern = fill",
                de: "Muster = Füllung",
                ru: "Шаблон = заливка",
                pt: "Padrão = preenchimento",
                nl: "Patroon = vulling",
                fr: "Motif = remplissage",
                it: "Motivo = riempimento",
                es: "Patrón = rellenar",
                pl: "Wzór = wypełnienie",
                uk: "Візерунок = заливка",
                "zh-cn": "图案 = 填充",
            },
            desc: "Create by Adapter",
            read: true,
            write: true,
            def: "#0000ff59",
        };
        await this.createDataPoint(
            `${this.iob.namespace}.${sn}.map.map_settings.region_pattern_fill`,
            common,
            "state",
            null,
            null,
            null,
        );
        common = {
            type: "string",
            role: "level.color.rgbw",
            name: {
                en: "Pattern = stroke",
                de: "Muster = Strich",
                ru: "Узор = штрих",
                pt: "Padrão = traço",
                nl: "Patroon = streep",
                fr: "Motif = trait",
                it: "Modello = tratto",
                es: "Patrón = trazo",
                pl: "Wzór = pociągnięcie",
                uk: "Візерунок = обведення",
                "zh-cn": "图案 = 笔画",
            },
            desc: "Create by Adapter",
            read: true,
            write: true,
            def: "#0000ff",
        };
        await this.createDataPoint(
            `${this.iob.namespace}.${sn}.map.map_settings.region_pattern_stroke`,
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
                en: "Pattern = lineWidth",
                de: "Muster = Linienbreite",
                ru: "Pattern = lineWidth",
                pt: "Padrão = larguraDaLinha",
                nl: "Patroon = lijnbreedte",
                fr: "Motif = largeur de ligne",
                it: "Modello = larghezza della linea",
                es: "Patrón = ancho de línea",
                pl: "Wzór = szerokość linii",
                uk: "Шаблон = ширина_лінії",
                "zh-cn": "图案 = 线宽",
            },
            desc: "Create by Adapter",
            read: true,
            write: true,
            unit: "px",
            def: 1,
        };
        await this.createDataPoint(
            `${this.iob.namespace}.${sn}.map.map_settings.region_pattern_lineWidth`,
            common,
            "state",
            null,
            null,
            null,
        );
        common = {
            type: "boolean",
            role: "switch",
            name: {
                en: "Display pattern as square/rectangle",
                de: "Muster als Quadrat/Rechteck anzeigen",
                ru: "Отображение узора в виде квадрата/прямоугольника",
                pt: "Exibir padrão como quadrado/retângulo",
                nl: "Patroon weergeven als vierkant/rechthoek",
                fr: "Afficher le motif sous forme de carré/rectangle",
                it: "Visualizza il modello come quadrato/rettangolo",
                es: "Mostrar el patrón como cuadrado/rectángulo",
                pl: "Wyświetl wzór jako kwadrat/prostokąt",
                uk: "Відображення шаблону у вигляді квадрата/прямокутника",
                "zh-cn": "显示图案为正方形/矩形",
            },
            desc: "Create by Adapter",
            read: true,
            write: true,
            def: false,
        };
        await this.createDataPoint(
            `${this.iob.namespace}.${sn}.map.map_settings.region_pattern_active`,
            common,
            "state",
            null,
            null,
            null,
        );
        common = {
            type: "string",
            role: "level.color.rgbw",
            name: {
                en: "Passage areas = fill",
                de: "Durchgangsbereiche = füllen",
                ru: "Проходы = заполнить",
                pt: "Áreas de passagem = preenchimento",
                nl: "Doorgangsgebieden = vullen",
                fr: "Zones de passage = remplissage",
                it: "aree di passaggio = riempimento",
                es: "Áreas de paso = rellenar",
                pl: "Obszary przejść = wypełnienie",
                uk: "Прохідні зони = заповнення",
                "zh-cn": "通道区域 = 填充",
            },
            desc: "Create by Adapter",
            read: true,
            write: true,
            def: "#80808059",
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
            role: "level.color.rgbw",
            name: {
                en: "Passage areas = stroke",
                de: "Durchgangsbereiche = Strich",
                ru: "Проходные зоны = инсульт",
                pt: "Áreas de passagem = acidente vascular cerebral",
                nl: "Passagegebieden = beroerte",
                fr: "Zones de passage = trait",
                it: "aree di passaggio = tratto",
                es: "Áreas de paso = accidente cerebrovascular",
                pl: "Obszary przejść = udar",
                uk: "Площі проходу = хід",
                "zh-cn": "通道区域 = 划痕",
            },
            desc: "Create by Adapter",
            read: true,
            write: true,
            def: "#808080",
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
                en: "Passage areas = lineWidth",
                de: "Durchgangsbereiche = Linienbreite",
                ru: "Проходные зоны = ширина линии",
                pt: "Áreas de passagem = largura da linha",
                nl: "Passagegebieden = lijnbreedte",
                fr: "Zones de passage = largeur de ligne",
                it: "Aree di passaggio = larghezza della linea",
                es: "Áreas de paso = ancho de línea",
                pl: "Obszary przejść = szerokość linii",
                uk: "Площі проходу = ширина лінії",
                "zh-cn": "通道区域 = 线宽",
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
            type: "boolean",
            role: "switch",
            name: {
                en: "Show passage areas",
                de: "Durchgangsbereiche anzeigen",
                ru: "Показать проходные зоны",
                pt: "Mostrar áreas de passagem",
                nl: "Toon doorgangsgebieden",
                fr: "Afficher les zones de passage",
                it: "Mostra le aree di passaggio",
                es: "Mostrar zonas de paso",
                pl: "Pokaż obszary przejść",
                uk: "Показати зони проходу",
                "zh-cn": "显示通道区域",
            },
            desc: "Create by Adapter",
            read: true,
            write: true,
            def: true,
        };
        await this.createDataPoint(
            `${this.iob.namespace}.${sn}.map.map_settings.region_channel_active`,
            common,
            "state",
            null,
            null,
            null,
        );
        common = {
            type: "string",
            role: "level.color.rgbw",
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
            def: "#228b22",
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
            role: "level.color.rgbw",
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
            def: "#000000",
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
            role: "level.color.rgbw",
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
            def: "#f08080C7",
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
            role: "level.color.rgbw",
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
            def: "#ff0000",
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
            role: "level.color.rgbw",
            name: {
                en: "Region forbidden (Night) = fill",
                de: "Verbotene Region (Nacht) = füllen",
                ru: "Запрещенный регион (ночь) = заполнение",
                pt: "Região proibida (Noite) = cheia",
                nl: "Regio verboden (Nacht) = invullen",
                fr: "Région interdite (nuit) = plein",
                it: "Zona vietata (Notte) = compila",
                es: "Región prohibida (noche) = llenar",
                pl: "Region zabroniony (noc) = wypełnij",
                uk: "Область заборонена (Ніч) = заповнити",
                "zh-cn": "禁区（夜间）= 填充",
            },
            desc: "Create by Adapter",
            read: true,
            write: true,
            def: "#f08080C7",
        };
        await this.createDataPoint(
            `${this.iob.namespace}.${sn}.map.map_settings.region_forbidden_dark_fill`,
            common,
            "state",
            null,
            null,
            null,
        );
        common = {
            type: "string",
            role: "level.color.rgbw",
            name: {
                en: "Region forbidden (Night) = stroke",
                de: "Verbotener Bereich (Nacht) = Strich",
                ru: "Запрещенный регион (ночь) = штрих",
                pt: "Região proibida (noite) = traço",
                nl: "Verboden gebied (Nacht) = streep",
                fr: "Région interdite (nuit) = trait",
                it: "Regione vietata (Notte) = tratto",
                es: "Región prohibida (noche) = trazo",
                pl: "Region zabroniony (noc) = pociągnięcie",
                uk: "Заборонена область (Ніч) = штрих",
                "zh-cn": "禁区（夜间）= 中风",
            },
            desc: "Create by Adapter",
            read: true,
            write: true,
            def: "#ff0000",
        };
        await this.createDataPoint(
            `${this.iob.namespace}.${sn}.map.map_settings.region_forbidden_dark_stroke`,
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
                en: "Region forbidden night = linewidth",
                de: "Region verboten Nacht = Linienbreite",
                ru: "Запрещенная для региона ночь = ширина строки",
                pt: "Região proibida à noite = largura da linha",
                nl: "Regio verboden nacht = lijnbreedte",
                fr: "Région interdite la nuit = largeur de ligne",
                it: "Regione proibita notte = larghezza linea",
                es: "Región prohibida noche = ancho de línea",
                pl: "Region zabroniony w nocy = szerokość linii",
                uk: "Заборонена область ніч = ширина лінії",
                "zh-cn": "禁夜区域 = 线宽",
            },
            desc: "Create by Adapter",
            read: true,
            write: true,
            unit: "px",
            def: 1,
        };
        await this.createDataPoint(
            `${this.iob.namespace}.${sn}.map.map_settings.region_forbidden_dark_lineWidth`,
            common,
            "state",
            null,
            null,
            null,
        );
        common = {
            type: "string",
            role: "level.color.rgbw",
            name: {
                en: "Region forbidden as wall = fill",
                de: "Verbotene Region als Wall = fill",
                ru: "Область, запрещенная в качестве стены = заполнение",
                pt: "Área proibida como muro = encher",
                nl: "Gebied dat verboden is, want muur = opvullen",
                fr: "Zone interdite car mur = remplissage",
                it: "Zona vietata come muro = fill",
                es: "Región prohibida como muro = llenar",
                pl: "Region zabroniony jako ściana = wypełnienie",
                uk: "Область заборонена як стіна = заливка",
                "zh-cn": "禁止作为墙壁的区域 = 填充",
            },
            desc: "Create by Adapter",
            read: true,
            write: true,
            def: "#f08080C7",
        };
        await this.createDataPoint(
            `${this.iob.namespace}.${sn}.map.map_settings.region_forbidden_wall_fill`,
            common,
            "state",
            null,
            null,
            null,
        );
        common = {
            type: "string",
            role: "level.color.rgbw",
            name: {
                en: "Region forbidden as wall = stroke",
                de: "Verbotene Region als Wand = Strich",
                ru: "Запрещенная область: стена = инсульт",
                pt: "Região proibida como muro = traço",
                nl: "Gebied dat verboden is, want muur = slag",
                fr: "Région interdite car mur = AVC",
                it: "Zona vietata come muro = ictus",
                es: "Región prohibida como pared = ictus",
                pl: "Region zabroniony jako ściana = skok",
                uk: "Область заборонена як стіна = штрих",
                "zh-cn": "禁止作为墙壁的区域 = 笔触",
            },
            desc: "Create by Adapter",
            read: true,
            write: true,
            def: "#ff0000",
        };
        await this.createDataPoint(
            `${this.iob.namespace}.${sn}.map.map_settings.region_forbidden_wall_stroke`,
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
                en: "Region forbidden as wall = linewidth",
                de: "Verbotene Region als Wand = Linienbreite",
                ru: "Запрещенная область: стена = ширина линии",
                pt: "Região proibida como muro = linha",
                nl: "Gebied dat verboden is, want wall = linewidth",
                fr: "Région interdite car mur = largeur de ligne",
                it: "Zona vietata come muro = linewidth",
                es: "Región prohibida como pared = ancho de línea",
                pl: "Region zabroniony jako ściana = szerokość linii",
                uk: "Область заборонена як стінка = ширина лінії",
                "zh-cn": "禁区为墙 = 线宽",
            },
            desc: "Create by Adapter",
            read: true,
            write: true,
            unit: "px",
            def: 1,
        };
        await this.createDataPoint(
            `${this.iob.namespace}.${sn}.map.map_settings.region_forbidden_wall_lineWidth`,
            common,
            "state",
            null,
            null,
            null,
        );
        common = {
            type: "boolean",
            role: "switch",
            name: {
                en: "Show forbidden region",
                de: "Verbotene Region anzeigen",
                ru: "Показать запрещенную область",
                pt: "Mostrar região proibida",
                nl: "Toon verboden gebied",
                fr: "Afficher la zone interdite",
                it: "Mostra la regione proibita",
                es: "Mostrar región prohibida",
                pl: "Pokaż zakazany region",
                uk: "Показати заборонену область",
                "zh-cn": "显示禁区",
            },
            desc: "Create by Adapter",
            read: true,
            write: true,
            def: true,
        };
        await this.createDataPoint(
            `${this.iob.namespace}.${sn}.map.map_settings.region_forbidden_active`,
            common,
            "state",
            null,
            null,
            null,
        );
        common = {
            type: "string",
            role: "level.color.rgbw",
            name: {
                en: "Safe region = fill",
                de: "Sicherer Bereich = füllen",
                ru: "Безопасная зона = заполнить",
                pt: "Região segura = preencher",
                nl: "Veilige regio = vullen",
                fr: "Zone de sécurité = remplir",
                it: "Regione sicura = riempire",
                es: "Región segura = rellenar",
                pl: "Obszar bezpieczny = wypełnienie",
                uk: "Безпечна область = заповнити",
                "zh-cn": "安全区域 = 填充",
            },
            desc: "Create by Adapter",
            read: true,
            write: true,
            def: "#0000ff96",
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
            role: "level.color.rgbw",
            name: {
                en: "Safe region = stroke",
                de: "Sichere Region = Strich",
                ru: "Безопасная зона = инсульт",
                pt: "Região segura = acidente vascular cerebral",
                nl: "Veilig gebied = beroerte",
                fr: "Zone de sécurité = AVC",
                it: "Regione sicura = ictus",
                es: "Región segura = accidente cerebrovascular",
                pl: "Obszar bezpieczny = udar",
                uk: "Безпечна область = інсульт",
                "zh-cn": "安全区域 = 中风",
            },
            desc: "Create by Adapter",
            read: true,
            write: true,
            def: "#0000ff",
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
                en: "Safe region = linewidth",
                de: "Sicherheitsbereich = Linienbreite",
                ru: "Безопасная область = ширина линии",
                pt: "Região segura = largura da linha",
                nl: "Veilig gebied = lijnbreedte",
                fr: "Zone de sécurité = largeur de ligne",
                it: "Regione sicura = larghezza della linea",
                es: "Región segura = ancho de línea",
                pl: "Obszar bezpieczny = szerokość linii",
                uk: "Безпечна область = ширина лінії",
                "zh-cn": "安全区域 = 线宽",
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
            type: "boolean",
            role: "switch",
            name: {
                en: "Show safe region",
                de: "Sichere Region anzeigen",
                ru: "Показать безопасную зону",
                pt: "Mostrar região segura",
                nl: "Veilige regio weergeven",
                fr: "Afficher la zone de sécurité",
                it: "Mostra la regione sicura",
                es: "Mostrar región segura",
                pl: "Pokaż bezpieczny region",
                uk: "Показати безпечний регіон",
                "zh-cn": "显示安全区域",
            },
            desc: "Create by Adapter",
            read: true,
            write: true,
            def: true,
        };
        await this.createDataPoint(
            `${this.iob.namespace}.${sn}.map.map_settings.region_placed_blank_active`,
            common,
            "state",
            null,
            null,
            null,
        );
        common = {
            type: "string",
            role: "level.color.rgbw",
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
            def: "#808080C7",
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
            role: "level.color.rgbw",
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
            def: "#a9a9a9",
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
            type: "boolean",
            role: "switch",
            name: {
                en: "Show obstacle region",
                de: "Hindernisbereich anzeigen",
                ru: "Показать область препятствий",
                pt: "Mostrar região de obstáculos",
                nl: "Toon obstakelgebied",
                fr: "Afficher la zone d'obstacle",
                it: "Mostra la regione degli ostacoli",
                es: "Mostrar región de obstáculos",
                pl: "Pokaż obszar przeszkód",
                uk: "Показати область перешкод",
                "zh-cn": "显示障碍区域",
            },
            desc: "Create by Adapter",
            read: true,
            write: true,
            def: true,
        };
        await this.createDataPoint(
            `${this.iob.namespace}.${sn}.map.map_settings.region_obstacle_active`,
            common,
            "state",
            null,
            null,
            null,
        );
        common = {
            type: "string",
            role: "level.color.rgbw",
            name: {
                en: "Divide work area = stroke",
                de: "Arbeitsbereich teilen = Strich",
                ru: "Разделить рабочую область = штрих",
                pt: "Dividir a área de trabalho = traço",
                nl: "Werkgebied verdelen = streep",
                fr: "Diviser la zone de travail = trait",
                it: "Dividi l'area di lavoro = tratto",
                es: "Dividir el área de trabajo = trazo",
                pl: "Podziel obszar roboczy = obrys",
                uk: "Розділення робочої області = хід",
                "zh-cn": "分割工作区域 = 笔画",
            },
            desc: "Create by Adapter",
            read: true,
            write: true,
            def: "#000000",
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
                en: "Divide work area = linewidth",
                de: "Arbeitsbereich teilen = Linienbreite",
                ru: "Разделите рабочую область на две части по ширине линии.",
                pt: "Dividir área de trabalho = largura da linha",
                nl: "Werkgebied verdelen = lijnbreedte",
                fr: "Zone de travail divisée = largeur de ligne",
                it: "Dividere l'area di lavoro = larghezza della linea",
                es: "Área de trabajo dividida = ancho de línea",
                pl: "Podziel obszar roboczy = szerokość linii",
                uk: "Розділити робочу область = ширина лінії",
                "zh-cn": "划分工作区域 = 线宽",
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
            type: "boolean",
            role: "switch",
            name: {
                en: "Divide area show",
                de: "Bereichsteilung anzeigen",
                ru: "Разделить область показать",
                pt: "Dividir área mostrar",
                nl: "Verdeel het gebied dat wordt weergegeven",
                fr: "Afficher la zone divisée",
                it: "Dividi area mostra",
                es: "Mostrar área de división",
                pl: "Pokaż obszar podziału",
                uk: "Показати розділену область",
                "zh-cn": "划分区域显示",
            },
            desc: "Create by Adapter",
            read: true,
            write: true,
            def: true,
        };
        await this.createDataPoint(
            `${this.iob.namespace}.${sn}.map.map_settings.divide_area_work_active`,
            common,
            "state",
            null,
            null,
            null,
        );
        common = {
            type: "string",
            role: "level.color.rgbw",
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
            def: "#7cfc00",
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
                en: "Mowing history line width",
                de: "Mähverlauf Linienbreite",
                ru: "Ширина линии истории скашивания",
                pt: "largura da linha do histórico de corte de grama",
                nl: "Maaigeschiedenis lijnbreedte",
                fr: "Largeur de la ligne de l'historique de tonte",
                it: "larghezza della linea della cronologia di falciatura",
                es: "Ancho de línea del historial de corte",
                pl: "Szerokość linii historii koszenia",
                uk: "Ширина лінії історії скошування",
                "zh-cn": "割草历史记录线宽",
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
                        de: "Standard-Multiangle verwenden",
                        ru: "Используйте стандартный многоугольный",
                        pt: "Use multiângulo padrão",
                        nl: "Gebruik de standaard Multi-Angle",
                        fr: "Utilisez le multi-angle standard",
                        it: "Usa multiangolo standard",
                        es: "Use multiángulo estándar",
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
                        en: "0: Standard setting 1: Custom setting",
                        de: "0: Standardeinstellung 1: Benutzerdefiniert Einstellung",
                        ru: "0: Стандартная настройка 1: пользовательская настройка",
                        pt: "0: Ajuste padrão 1: Personalizado",
                        nl: "0: Standaardinstelling 1: Aangepaste instelling",
                        fr: "0 : Réglage standard 1 : réglage personnalisé",
                        it: "0: Impostazione standard 1: Personalizzata",
                        es: "0: Ajuste estándar 1: Ajuste personalizado",
                        pl: "0: Ustawienie standardowe 1: Ustawienie niestandardowe",
                        uk: "0: Стандартна настройка 1: Користувальницькі налаштування",
                        "zh-cn": "0：标准设置 1：自定义设置",
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
        const meta = this.deviceMeta[sn];
        if (meta && meta.modelClass === "S" && meta.gen === "Gen2") {
            common.states[3] = "Efficient";
        }
        await this.createDataPoint(`${this.iob.namespace}.${path}.plan_mode`, common, "state", null, null, null);
    },
    /**
     * @param {string} sn
     * @param {any} data
     */
    async createSettings(sn, data) {
        let common;
        const meta = this.deviceMeta[sn];
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
        if (data.follow_border_laps != null && meta && meta.gen === "Gen2") {
            common = {
                name: {
                    en: "Edge mowing rounds",
                    de: "Kantenmährunden",
                    ru: "Круглые косилки для обрезки краев газона",
                    pt: "Corte de bordas circulares",
                    nl: "Randmaairondes",
                    fr: "Rondes de tonte de bordure",
                    it: "rondelle per falciatura dei bordi",
                    es: "Recorridos de corte de bordes",
                    pl: "Cykle koszenia krawędzi",
                    uk: "Круги для скошування країв",
                    "zh-cn": "边缘修剪",
                },
                type: "number",
                role: "level",
                write: true,
                read: true,
                def: 1,
                states: {
                    1: "1 round",
                    2: "2 rounds",
                    3: "3 rounds",
                },
            };
            this.emit("objectExists", `${sn}.settings.follow_border_laps`);
            await this.createDataPoint(
                `${this.iob.namespace}.${sn}.settings.follow_border_laps`,
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
            if (meta && meta.modelClass === "S" && meta.gen === "Gen2") {
                common.states[3] = "efficient";
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
                    en: "Enable/disable automatic firmware updates",
                    de: "Automatische Firmware-Updates aktivieren/deaktivieren",
                    ru: "Включение/отключение автоматических обновлений прошивки",
                    pt: "Ativar/desativar atualizações automáticas de firmware",
                    nl: "Automatische firmware-updates in- of uitschakelen",
                    fr: "Activer/désactiver les mises à jour automatiques du micrologiciel",
                    it: "Attiva/disattiva gli aggiornamenti automatici del firmware",
                    es: "Habilitar/deshabilitar las actualizaciones automáticas del firmware",
                    pl: "Włącz/wyłącz automatyczne aktualizacje oprogramowania sprzętowego",
                    uk: "Увімкнути/вимкнути автоматичне оновлення прошивки",
                    "zh-cn": "启用/禁用固件自动更新",
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
            this.emit("objectExists", `${sn}.settings.reset_small_blade`);
            await this.createDataPoint(
                `${this.iob.namespace}.${sn}.settings.reset_small_blade`,
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
            this.emit("objectExists", `${sn}.settings.reset_small_bladeplate`);
            await this.createDataPoint(
                `${this.iob.namespace}.${sn}.settings.reset_small_bladeplate`,
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
                if (meta && (meta.modelClass === "S" || this.options.apptype === "X")) {
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
            this.emit("objectExists", `${sn}.remote.set_screen_duration`);
            await this.createDataPoint(
                `${this.iob.namespace}.${sn}.remote.set_screen_duration`,
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
        const meta = this.deviceMeta[sn];
        if (
            ((meta && data.time_zone != null) || data.wirelessTimeZone != null) &&
            isAvailable[`${sn}.schedule.schedule_time_zone`]
        ) {
            const tz = data.time_zone != null ? data.time_zone : data.wirelessTimeZone;
            await this.iob.setState(`${sn}.schedule.schedule_time_zone`, { val: tz, ack: true });
            meta.time_zone = tz;
        }
        if (data.time_work_repeat != null) {
            await this.iob.setState(`${sn}.schedule.schedule_time_work_repeat`, {
                val: data.time_work_repeat,
                ack: true,
            });
        }
        if (meta && meta.profile) {
            if (data.daylight_time_auto_set != null) {
                await this.iob.setState(`${sn}.profile.timezone.daylight_time_auto_set`, {
                    val: data.daylight_time_auto_set,
                    ack: true,
                });
            }
            if (data.daylight_time_enable != null) {
                await this.iob.setState(`${sn}.profile.timezone.daylight_time_enable`, {
                    val: data.daylight_time_enable,
                    ack: true,
                });
            }
            if (data.timeZoneId != null && data.timeZoneId != "") {
                await this.iob.setState(`${sn}.profile.timezone.changeTimezone`, { val: data.timeZoneId, ack: true });
            }
        }
        if (data.docking_path != null && isAvailable[`${sn}.remote.set_return_path`]) {
            await this.iob.setState(`${sn}.remote.set_return_path`, { val: data.docking_path, ack: true });
        }
        if (data.border_first != null && isAvailable[`${sn}.remote.set_border_first`]) {
            await this.iob.setState(`${sn}.remote.set_border_first`, { val: data.border_first, ack: true });
        }
        if (data.border_distance != null && isAvailable[`${sn}.remote.set_border_distance`]) {
            await this.iob.setState(`${sn}.remote.set_border_distance`, { val: data.border_distance, ack: true });
        }
        if (data.screen_lock != null && isAvailable[`${sn}.remote.set_screen_duration`]) {
            await this.iob.setState(`${sn}.remote.set_screen_duration`, { val: data.screen_lock, ack: true });
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
        if (data.follow_border_laps != null && isAvailable[`${sn}.settings.follow_border_laps`]) {
            await this.iob.setState(`${sn}.settings.follow_border_laps`, { val: data.follow_border_laps, ack: true });
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
                        this.log.warn(`createDataPoint: ${error}`);
                    });
            } else {
                let ischange = false;
                if (extend) {
                    let countStates = 0;
                    if (obj.common && common && common.states == null && obj.common.states != null) {
                        countStates = 1;
                    }
                    this.log.debug(`countStates: ${countStates}`);
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
                        this.log.debug(`INFORMATION - Extend common: ${this.iob.namespace}.${ident}`);
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
                    this.log.debug(`INFORMATION - Change common: ${this.iob.namespace}.${ident}`);
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
                this.log.error(`createDataPoint: ${error}`);
            } else if (error instanceof Error) {
                this.log.error(`createDataPoint: ${error.name}: ${error.message}`);
            }
        }
    },
    /**
     * @returns {any}
     */
    timezoneCode() {
        return {
            "Etc/GMT+12": "Etc/GMT+12 -12",
            "Pacific/Midway": "Pacific/Midway GMT-11",
            "US/Samoa": "US/Samoa GMT-11",
            "US/Hawaii": "US/Hawaii GMT-10",
            "US/Alaska": "US/Alaska GMT-9",
            "US/Pacific": "US/Pacific GMT-8",
            "America/Tijuana": "America/Tijuana GMT-8",
            "US/Arizona": "US/Arizona GMT-7",
            "US/Mountain": "US/Mountain GMT-7",
            "America/Chihuahua": "America/Chihuahua GMT-7",
            "America/Mazatlan": "America/Mazatlan GMT-7",
            "America/Mexico_City": "America/Mexico_City GMT-6",
            "America/Monterrey": "America/Monterrey GMT-6",
            "Canada/Saskatchewan": "Canada/Saskatchewan GMT-6",
            "US/Central": "US/Central GMT-6",
            "US/Eastern": "US/Eastern GMT-5",
            "US/East-Indiana": "US/East-Indiana GMT-5",
            "America/Bogota": "America/Bogota GMT-5",
            "America/Lima": "America/Lima GMT-5",
            "Canada/Atlantic": "Canada/Atlantic GMT-4",
            "America/La_Paz": "America/La_Paz GMT-4",
            "America/Santiago": "America/Santiago GMT-4",
            "America/Buenos_Aires": "America/Buenos_Aires GMT-3",
            Greenland: "Greenland GMT-3",
            "Atlantic/Stanley": "Atlantic/Stanley GMT-2",
            "Atlantic/Azores": "Atlantic/Azores GMT-1",
            "Atlantic/Cape_Verde": "Atlantic/Cape_Verde GMT-1",
            "Africa/Casablanca": "Africa/Casablanca GMT",
            "Europe/Dublin": "Europe/Dublin GMT",
            "Europe/Lisbon": "Europe/Lisbon GMT",
            "Europe/London": "Europe/London GMT",
            "Africa/Monrovia": "Africa/Monrovia GMT",
            "Europe/Amsterdam": "Europe/Amsterdam GMT+1",
            "Europe/Belgrade": "Europe/Belgrade GMT+1",
            "Europe/Berlin": "Europe/Berlin GMT+1",
            "Europe/Bratislava": "Europe/Bratislava GMT+1",
            "Europe/Brussels": "Europe/Brussels GMT+1",
            "Europe/Budapest": "Europe/Budapest GMT+1",
            "Europe/Copenhagen": "Europe/Copenhagen GMT+1",
            "Europe/Ljubljana": "Europe/Ljubljana GMT+1",
            "Europe/Madrid": "Europe/Madrid GMT+1",
            "Europe/Paris": "Europe/Paris GMT+1",
            "Europe/Prague": "Europe/Prague GMT+1",
            "Europe/Rome": "Europe/Rome GMT+1",
            "Europe/Sarajevo": "Europe/Sarajevo GMT+1",
            "Europe/Skopje": "Europe/Skopje GMT+1",
            "Europe/Stockholm": "Europe/Stockholm GMT+1",
            "Europe/Vienna": "Europe/Vienna GMT+1",
            "Europe/Warsaw": "Europe/Warsaw GMT+1",
            "Europe/Zagreb": "Europe/Zagreb GMT+1",
            "Europe/Athens": "Europe/Athens GMT+2",
            "Europe/Bucharest": "Europe/Bucharest GMT+2",
            "Africa/Cairo": "Africa/Cairo GMT+2",
            "Africa/Harare": "Africa/Harare GMT+2",
            "Europe/Helsinki": "Europe/Helsinki GMT+2",
            "Europe/Istanbul": "Europe/Istanbul GMT+2",
            "Asia/Jerusalem": "Asia/Jerusalem GMT+2",
            "Europe/Kiev": "Europe/Kiev GMT+2",
            "Europe/Minsk": "Europe/Minsk GMT+2",
            "Europe/Riga": "Europe/Riga GMT+2",
            "Europe/Sofia": "Europe/Sofia GMT+2",
            "Europe/Tallinn": "Europe/Tallinn GMT+2",
            "Europe/Vilnius": "Europe/Vilnius GMT+2",
            "Asia/Baghdad": "Asia/Baghdad GMT+3",
            "Asia/Kuwait": "Asia/Kuwait GMT+3",
            "Africa/Nairobi": "Africa/Nairobi GMT+3",
            "Asia/Riyadh": "Asia/Riyadh GMT+3",
            "Europe/Moscow": "Europe/Moscow GMT+4",
            "Asia/Baku": "Asia/Baku GMT+4",
            "Europe/Volgograd": "Europe/Volgograd GMT+4",
            "Asia/Muscat": "Asia/Muscat GMT+4",
            "Asia/Tbilisi": "Asia/Tbilisi GMT+4",
            "Asia/Yerevan": "Asia/Yerevan GMT+4",
            "Asia/Karachi": "Asia/Karachi GMT+5",
            "Asia/Tashkent": "Asia/Tashkent GMT+5",
            "Asia/Yekaterinburg": "Asia/Yekaterinburg GMT+6",
            "Asia/Almaty": "Asia/Almaty GMT+6",
            "Asia/Dhaka": "Asia/Dhaka GMT+6",
            "Asia/Novosibirsk": "Asia/Novosibirsk GMT+7",
            "Asia/Bangkok": "Asia/Bangkok GMT+7",
            "Asia/Jakarta": "Asia/Jakarta GMT+7",
            "Asia/Krasnoyarsk": "Asia/Krasnoyarsk GMT+8",
            "Asia/Chongqing": "Asia/Chongqing GMT+8",
            "Asia/Hong_Kong": "Asia/Hong_Kong GMT+8",
            "Asia/Kuala_Lumpur": "Asia/Kuala_Lumpur GMT+8",
            "Australia/Perth": "Australia/Perth GMT+8",
            "Asia/Singapore": "Asia/Singapore GMT+8",
            "Asia/Taipei": "Asia/Taipei GMT+8",
            "Asia/Ulaanbaatar": "Asia/Ulaanbaatar GMT+8",
            "Asia/Urumqi": "Asia/Urumqi GMT+8",
            "Asia/Irkutsk": "Asia/Irkutsk GMT+9",
            "Asia/Seoul": "Asia/Seoul GMT+9",
            "Asia/Tokyo": "Asia/Tokyo GMT+9",
            "Asia/Yakutsk": "Asia/Yakutsk GMT+10",
            "Australia/Brisbane": "Australia/Brisbane GMT+10",
            "Australia/Canberra": "Australia/Canberra GMT+10",
            "Pacific/Guam": "Pacific/Guam GMT+10",
            "Australia/Hobart": "Australia/Hobart GMT+10",
            "Australia/Melbourne": "Australia/Melbourne GMT+10",
            "Pacific/Port_Moresby": "Pacific/Port_Moresby GMT+10",
            "Australia/Sydney": "Australia/Sydney GMT+10",
            "Asia/Vladivostok": "Asia/Vladivostok GMT+11",
            "Asia/Magadan": "Asia/Magadan GMT+12",
            "Pacific/Auckland": "Pacific/Auckland GMT+12",
            "Pacific/Fiji": "Pacific/Fiji GMT+12",
        };
    },
    /**
     * @returns {any}
     */
    timezoneValue() {
        return {
            "GMT-12": -43200,
            "GMT-11": -39600,
            "GMT-10": -36000,
            "GMT-9": -32400,
            "GMT-8": -28800,
            "GMT-7": -25200,
            "GMT-6": -21600,
            "GMT-5": -18000,
            "GMT-4": -14400,
            "GMT-3": -10800,
            "GMT-2": -7200,
            "GMT-1": -3600,
            GMT: 0,
            "GMT+1": 3600,
            "GMT+2": 7200,
            "GMT+3": 10800,
            "GMT+4": 14400,
            "GMT+5": 18000,
            "GMT+6": 21600,
            "GMT+7": 25200,
            "GMT+8": 28800,
            "GMT+9": 32400,
            "GMT+10": 36000,
            "GMT+11": 39600,
            "GMT+12": 43200,
        };
    },
    /**
     * @returns {any}
     */
    getRegionISO() {
        return {
            AF: "Afghanistan",
            AL: "Albania",
            DZ: "Algeria",
            AS: "American Samoa",
            AD: "Andorra",
            AO: "Angola",
            AI: "Anguilla",
            AQ: "Antarctica",
            AG: "Antigua and Barbuda",
            AR: "Argentina",
            AM: "Armenia",
            AW: "Aruba",
            AU: "Australia",
            AT: "Austria",
            AZ: "Azerbaijan",
            BS: "Bahamas",
            BH: "Bahrain",
            BD: "Bangladesh",
            BB: "Barbados",
            BY: "Belarus",
            BE: "Belgium",
            BZ: "Belize",
            BJ: "Benin",
            BM: "Bermuda",
            BT: "Bhutan",
            BO: "Bolivia",
            BA: "Bosnia and Herzegovina",
            BW: "Botswana",
            BV: "Bouvet Island",
            BR: "Brazil",
            IO: "British Indian Ocean Territory",
            BN: "Brunei Darussalam",
            BG: "Bulgaria",
            BF: "Burkina Faso",
            BI: "Burundi",
            KH: "Cambodia",
            CM: "Cameroon",
            CA: "Canada",
            CV: "Cape Verde",
            KY: "Cayman Islands",
            CF: "Central African Republic",
            TD: "Chad",
            CL: "Chile",
            CN: ["People's Republic of China", "China"],
            CX: "Christmas Island",
            CC: "Cocos (Keeling) Islands",
            CO: "Colombia",
            KM: "Comoros",
            CG: ["Republic of the Congo", "Congo"],
            CD: ["Democratic Republic of the Congo", "Congo"],
            CK: "Cook Islands",
            CR: "Costa Rica",
            CI: ["Cote d'Ivoire", "Côte d'Ivoire", "Ivory Coast"],
            HR: "Croatia",
            CU: "Cuba",
            CY: "Cyprus",
            CZ: ["Czech Republic", "Czechia"],
            DK: "Denmark",
            DJ: "Djibouti",
            DM: "Dominica",
            DO: "Dominican Republic",
            EC: "Ecuador",
            EG: "Egypt",
            SV: "El Salvador",
            GQ: "Equatorial Guinea",
            ER: "Eritrea",
            EE: "Estonia",
            ET: "Ethiopia",
            FK: "Falkland Islands (Malvinas)",
            FO: "Faroe Islands",
            FJ: "Fiji",
            FI: "Finland",
            FR: "France",
            GF: "French Guiana",
            PF: "French Polynesia",
            TF: "French Southern Territories",
            GA: "Gabon",
            GM: ["Republic of The Gambia", "The Gambia", "Gambia"],
            GE: "Georgia",
            DE: "Germany",
            GH: "Ghana",
            GI: "Gibraltar",
            GR: "Greece",
            GL: "Greenland",
            GD: "Grenada",
            GP: "Guadeloupe",
            GU: "Guam",
            GT: "Guatemala",
            GN: "Guinea",
            GW: "Guinea-Bissau",
            GY: "Guyana",
            HT: "Haiti",
            HM: "Heard Island and McDonald Islands",
            VA: "Holy See (Vatican City State)",
            HN: "Honduras",
            HK: "Hong Kong",
            HU: "Hungary",
            IS: "Iceland",
            IN: "India",
            ID: "Indonesia",
            IR: ["Islamic Republic of Iran", "Iran"],
            IQ: "Iraq",
            IE: "Ireland",
            IL: "Israel",
            IT: "Italy",
            JM: "Jamaica",
            JP: "Japan",
            JO: "Jordan",
            KZ: "Kazakhstan",
            KE: "Kenya",
            KI: "Kiribati",
            KP: "North Korea",
            KR: ["South Korea", "Korea, Republic of", "Republic of Korea"],
            KW: "Kuwait",
            KG: "Kyrgyzstan",
            LA: "Lao People's Democratic Republic",
            LV: "Latvia",
            LB: "Lebanon",
            LS: "Lesotho",
            LR: "Liberia",
            LY: "Libya",
            LI: "Liechtenstein",
            LT: "Lithuania",
            LU: "Luxembourg",
            MO: "Macao",
            MG: "Madagascar",
            MW: "Malawi",
            MY: "Malaysia",
            MV: "Maldives",
            ML: "Mali",
            MT: "Malta",
            MH: "Marshall Islands",
            MQ: "Martinique",
            MR: "Mauritania",
            MU: "Mauritius",
            YT: "Mayotte",
            MX: "Mexico",
            FM: "Micronesia, Federated States of",
            MD: "Moldova, Republic of",
            MC: "Monaco",
            MN: "Mongolia",
            MS: "Montserrat",
            MA: "Morocco",
            MZ: "Mozambique",
            MM: "Myanmar",
            NA: "Namibia",
            NR: "Nauru",
            NP: "Nepal",
            NL: ["Netherlands", "The Netherlands", "Netherlands (Kingdom of the)"],
            NC: "New Caledonia",
            NZ: "New Zealand",
            NI: "Nicaragua",
            NE: "Niger",
            NG: "Nigeria",
            NU: "Niue",
            NF: "Norfolk Island",
            MK: ["The Republic of North Macedonia", "North Macedonia"],
            MP: "Northern Mariana Islands",
            NO: "Norway",
            OM: "Oman",
            PK: "Pakistan",
            PW: "Palau",
            PS: ["State of Palestine", "Palestine"],
            PA: "Panama",
            PG: "Papua New Guinea",
            PY: "Paraguay",
            PE: "Peru",
            PH: "Philippines",
            PN: ["Pitcairn", "Pitcairn Islands"],
            PL: "Poland",
            PT: "Portugal",
            PR: "Puerto Rico",
            QA: "Qatar",
            RE: "Reunion",
            RO: "Romania",
            RU: ["Russian Federation", "Russia"],
            RW: "Rwanda",
            SH: "Saint Helena",
            KN: "Saint Kitts and Nevis",
            LC: "Saint Lucia",
            PM: "Saint Pierre and Miquelon",
            VC: "Saint Vincent and the Grenadines",
            WS: "Samoa",
            SM: "San Marino",
            ST: "Sao Tome and Principe",
            SA: "Saudi Arabia",
            SN: "Senegal",
            SC: "Seychelles",
            SL: "Sierra Leone",
            SG: "Singapore",
            SK: "Slovakia",
            SI: "Slovenia",
            SB: "Solomon Islands",
            SO: "Somalia",
            ZA: "South Africa",
            GS: "South Georgia and the South Sandwich Islands",
            ES: "Spain",
            LK: "Sri Lanka",
            SD: "Sudan",
            SR: "Suriname",
            SJ: "Svalbard and Jan Mayen",
            SZ: "Eswatini",
            SE: "Sweden",
            CH: "Switzerland",
            SY: "Syrian Arab Republic",
            TW: ["Taiwan, Province of China", "Taiwan"],
            TJ: "Tajikistan",
            TZ: ["United Republic of Tanzania", "Tanzania"],
            TH: "Thailand",
            TL: "Timor-Leste",
            TG: "Togo",
            TK: "Tokelau",
            TO: "Tonga",
            TT: "Trinidad and Tobago",
            TN: "Tunisia",
            TR: ["Türkiye", "Turkey"],
            TM: "Turkmenistan",
            TC: "Turks and Caicos Islands",
            TV: "Tuvalu",
            UG: "Uganda",
            UA: "Ukraine",
            AE: ["United Arab Emirates", "UAE"],
            GB: ["United Kingdom", "UK", "Great Britain"],
            US: ["United States of America", "United States", "USA", "U.S.A.", "US", "U.S."],
            UM: "United States Minor Outlying Islands",
            UY: "Uruguay",
            UZ: "Uzbekistan",
            VU: "Vanuatu",
            VE: "Venezuela",
            VN: "Vietnam",
            VG: "Virgin Islands, British",
            VI: "Virgin Islands, U.S.",
            WF: "Wallis and Futuna",
            EH: "Western Sahara",
            YE: "Yemen",
            ZM: "Zambia",
            ZW: "Zimbabwe",
            AX: ["Åland Islands", "Aland Islands"],
            BQ: "Bonaire, Sint Eustatius and Saba",
            CW: "Curaçao",
            GG: "Guernsey",
            IM: "Isle of Man",
            JE: "Jersey",
            ME: "Montenegro",
            BL: "Saint Barthélemy",
            MF: "Saint Martin (French part)",
            RS: "Serbia",
            SX: "Sint Maarten (Dutch part)",
            SS: "South Sudan",
            XK: "Kosovo",
        };
    },
};

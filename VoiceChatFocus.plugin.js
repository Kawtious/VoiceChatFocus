/**
 * @name Voice Chat Focus
 * @version 1.1.1
 * @author Z'ark Ashveil
 * @authorId 262113677900120065
 * @authorLink https://github.com/Kawtious
 * @description Focuses on a user's voice by muting everyone else
 * @source https://github.com/Kawtious/VoiceChatFocus
 * @updateUrl https://raw.githubusercontent.com/Kawtious/VoiceChatFocus/main/VoiceChatFocus.plugin.js
 */

const PLUGIN_ID = "VoiceChatFocus";

const UserStore = BdApi.Webpack.Stores.UserStore;
const VoiceStateStore = BdApi.Webpack.Stores.VoiceStateStore;
const MediaEngineStore = BdApi.Webpack.Stores.MediaEngineStore;

const Dispatcher = UserStore._dispatcher;

const FOCUS_BUTTON_STYLE = `
    @property --vcf-angle {
        syntax: "<angle>";
        initial-value: 0deg;
        inherits: false;
    }

    @keyframes vcfFadeIn {
        0% {
            opacity: 0;
        }
        100% {
            opacity: 1;
        }
    }

    @keyframes vcfSpin {
        to {
            --vcf-angle: 360deg;
        }
    }

    .vcf-focused::before {
        content: "";
        position: absolute;
        inset: 0;
        padding: 2px;
        border-radius: 8px;

        background: conic-gradient(
            from var(--vcf-angle),
            transparent 90deg,
            #b52a37 180deg,
            #e16741 270deg,
            transparent 360deg
        );

        mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
        mask-composite: exclude;

        animation: vcfFadeIn 1s, vcfSpin 3s linear infinite;
    }
`;

module.exports = class VoiceChatFocus {
    constructor() {
        this.focusedUserId = null;
        this.mutedUsers = [];
        this.voiceStateListener = (payload) => this.onVoiceStateUpdate(payload);
    }

    start() {
        this.unpatch = BdApi.ContextMenu.patch(
            "user-context",
            (element, context) => this.patchUserContext(element, context)
        );

        Dispatcher.subscribe(
            "VOICE_STATE_UPDATES",
            this.voiceStateListener
        );

        BdApi.DOM.addStyle(
            PLUGIN_ID,
            FOCUS_BUTTON_STYLE
        );

        BdApi.Patcher.after(
            PLUGIN_ID,
            BdApi.Webpack.getByStrings("getProgressForUserId", { defaultExport: false }),
            "Ay",
            (_, args, returnValue) => this.patchVoiceUserElement(args[0], returnValue)
        );
    }

    stop() {
        this.unpatch?.();
        Dispatcher.unsubscribe("VOICE_STATE_UPDATES", this.voiceStateListener);
        BdApi.DOM.removeStyle(PLUGIN_ID);
        BdApi.Patcher.unpatchAll(PLUGIN_ID);
    }

    onFocusButtonClick(userId) {
        if (this.focusedUserId !== userId) {
            this.focus(userId);
        } else {
            this.unfocus();
        }
    }

    onVoiceStateUpdate(payload) {
        if (!this.focusedUserId) return;

        const voiceState = payload.voiceStates[0];

        // User hasn't left the channel
        if (!voiceState.oldChannelId) return;

        const myId = UserStore.getCurrentUser().id;

        // Voice state is neither from focused user nor you
        if (voiceState.userId !== this.focusedUserId && voiceState.userId !== myId) return;

        this.unfocus();
    }

    patchUserContext(element, context) {
        const myId = UserStore.getCurrentUser().id;

        // Return if you're right-clicking yourself
        if (myId === context.user.id) return;

        const myVoiceState = VoiceStateStore.getVoiceStateForUser(myId);
        const userVoiceState = VoiceStateStore.getVoiceStateForUser(context.user.id);

        // Check if both you and the other user are in a voice channel
        if (!myVoiceState || !userVoiceState) return;

        // Only show if in same voice channel
        if (myVoiceState.channelId !== userVoiceState.channelId) return;

        const menu = BdApi.Utils.findInTree(
            element,
            // - element.props.children[0].props.children[4].props.children[0]
            // The context menu group for self-mute and self-deafen is behind an array (children[0]),
            //  and I don't know how to walk to it. "props" and "children" aren't of much use to find
            //  the array that contains the group itself, so I look for an array that contains an item
            //  with the key "self-mute" and that is also inside another array
            //  
            prop =>
                Array.isArray(prop) &&
                prop.some(prop2 =>
                    Array.isArray(prop2) &&
                    prop2.some(e => e.key === "self-mute")
                ),
            { walkable: ["props", "children"] }
        );

        menu[0].push(
            BdApi.ContextMenu.buildItem(
                {
                    label: this.focusedUserId !== context.user.id ? "Focus User" : "Unfocus User",
                    action: () => this.onFocusButtonClick(context.user.id)
                }
            )
        );
    }

    patchVoiceUserElement(context, element) {
        const userId = context?.user?.id;

        if (!userId || !element?.props) return element;

        const className = element.props.className || "";

        if (userId === this.focusedUserId) {
            element.props.className = className + " vcf-focused";
        } else {
            element.props.className = className.replace("vcf-focused", "");
        }

        return element;
    }

    focus(userId) {
        const myId = UserStore.getCurrentUser().id;

        // You can't focus yourself
        if (myId === userId) return;

        const myVoiceState = VoiceStateStore.getVoiceStateForUser(myId);
        const userVoiceState = VoiceStateStore.getVoiceStateForUser(userId);

        // Check if both you and the other user are in a voice channel
        if (!myVoiceState || !userVoiceState) return;

        // Only focus if in same voice channel
        if (myVoiceState.channelId !== userVoiceState.channelId) return;

        const channelVoiceStates = VoiceStateStore.getVoiceStatesForChannel(myVoiceState.channelId);

        if (!channelVoiceStates) return;

        this.focusedUserId = userId;

        Object.values(channelVoiceStates)
            .filter(state => {
                return state.userId !== myId;
            })
            .forEach(state => {
                const isUserMuted = state.userId in MediaEngineStore.getSettings().localMutes;

                // If the user is not the focused user but is already muted 
                if (state.userId !== userId && isUserMuted) return;

                // If the user is the focused user but isn't muted
                if (state.userId === userId && !isUserMuted) return;

                this.mutedUsers.push(state.userId);

                Dispatcher.dispatch({
                    type: "AUDIO_TOGGLE_LOCAL_MUTE",
                    userId: state.userId
                });
            });
    }

    unfocus() {
        this.focusedUserId = null;

        for (const userId of this.mutedUsers) {
            const isUserMuted = userId in MediaEngineStore.getSettings().localMutes;

            if (!isUserMuted) return;

            Dispatcher.dispatch({
                type: "AUDIO_TOGGLE_LOCAL_MUTE",
                userId: userId
            });
        }

        this.mutedUsers.length = 0;
    }
};

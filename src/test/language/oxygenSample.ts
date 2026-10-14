// A synthetic DITA topic laid out the way Oxygen's Format and Indent lays out a
// real one (4-space indent, width 100): <fig> and <ul> inside text, wrapped
// start tags, owner end tags on their own line, unbreakable runs longer than
// the width. Placeholder text only. The formatter must leave it untouched.
export const OXYGEN_FORMATTED_SAMPLE = `<topic id="123" xml:lang="zh-CN">
    <body>
        <p><ph keyref="product_name"/>aaaaaaaaaaaaaaa,aaaaaaaaaaaaaaa,aaaaaa. <fig
                id="fig_oyb_3zh_rjc">
                <title>aaaaaaaaaa</title>
                <image placement="break" href="../images/_1.png" scale="70" id="image_pyb_3zh_rjc"/>
            </fig>
        </p>
        <section id="section_hhf_dhb_tjc">
            <title>aaaa</title>
            <p>aaaaaaaaaa,a,aaaaaaa.</p>
        </section>
        <section id="section_sjm_jzh_rjc">
            <title>aaaa</title>
            <ol id="ol_l3g_kzh_rjc">
                <li>aa<uicontrol>aa</uicontrol>aa<uicontrol>aaa</uicontrol>aa.</li>
                <li>aaaaaa,aaaaaaaaa,aaaaaaa.</li>
                <li>aaaaaaaaaaa,aaaaaaaaa.</li>
                <li>aaaaaaaaaaa.aaaaaaaa,aaaaaaaa: <ul id="ol_kzz_513_rjc">
                        <li><b>aaaaa</b>:aaaaaaaaa<b>aa</b>aaa,aaaaaaaaaaaa.aaaaa,aaaaaaaa,aaaaaaa,aaaaaaa.aaa,aaaaaaaaaaaaa(aaa),aaaaaaaaaaaaaa(aaa),aaaaa.
                                <fig id="fig_ecr_sgj_rjc">
                                <title>aaaaaaaaaaaaaa</title>
                                <image placement="break" href="../images/_2.png" scale="70"
                                    id="image_fcr_sgj_rjc"/>
                            </fig>
                        </li>
                        <li><b>aaaaa</b>:aaaaaaaaaaa,aaaaaaaaa,aaaaaaaaaaaaaaaa,aaaaaaa.aaaaa,aaaaaaaaa,aaaaaaa,aaaaaaa.aaa,aaaa,aaaaaaaaaaaaaaaa.aa,aaaaaaaaa,aaaaaaa(aaaaaa),aaaaaaaaaa(aaaaaa),aaaaaaa.
                                <fig id="fig_vj5_rq3_rjc">
                                <title>aaaaaaaaaaaaaaa</title>
                                <image placement="break" href="../images/_3.png" scale="70"
                                    id="image_wj5_rq3_rjc"/>
                            </fig>
                        </li>
                    </ul>
                </li>
            </ol>
            <note type="note">
                <p>aaaaaaaaaaaaaa,aaaaaaaaaa,aaaaaaaaaaaaaa.aaaaaaaaaaaaaaaaaaaaaaaaaaaaa 00°
                    aaa,aaaaaaaaaaaaaaaa,aaaaaaaaaaaaaaaa.</p>
            </note>
        </section>
        <section id="section_xly_n4j_rjc">
            <title>aaaa</title>
            <p><uicontrol>aaa</uicontrol>:aaaaaa,aaaaaaaaaaaaaaaaa. <ul id="ul_dp1_s4j_rjc">
                    <li><b>aaaaa</b>:aaaaaaaaaaaaa,aaaaaaaaaa.</li>
                    <li><b>aaaaa</b>:aaaaaaaaaa.</li>
                </ul>
            </p>
        </section>
    </body>
</topic>
`;
